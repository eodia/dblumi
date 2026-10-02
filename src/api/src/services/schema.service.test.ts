import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the Trino branch of fetchSchema().
 *
 * `runTrino` is replaced by a fake coordinator keyed on the statement text, so
 * the degraded paths a real datalake produces — a columns query that fails or
 * times out, a capped drain — can be exercised without a cluster. The quoting
 * and target-parsing helpers stay real.
 *
 * config, logger and the connection manager are mocked as in
 * copilot.service.test.ts: config validates process.env at import time.
 */

type FakeResult = {
  rows: Record<string, unknown>[]
  data: unknown[][]
  truncated: boolean
}

type Reply = FakeResult | Error

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  runTrino: vi.fn(),
}))

vi.mock('../config.js', () => ({ config: { LOG_LEVEL: 'silent' } }))
vi.mock('../logger.js', () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../lib/connection-manager.js', () => ({
  connectionManager: { liveDatabase: () => undefined },
}))
vi.mock('../lib/mongo.js', () => ({ getMongoSchema: vi.fn(), mongoDatabaseName: vi.fn() }))
vi.mock('../lib/trino.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/trino.js')>()),
  runTrino: mocks.runTrino,
}))

const { fetchSchema } = await import('./schema.service.js')

function result(rows: Record<string, unknown>[], truncated = false): FakeResult {
  return { rows, data: rows.map((r) => Object.values(r)), truncated }
}

const schemasOf = (...names: string[]) => result(names.map((schema_name) => ({ schema_name })))
const table = (table_name: string, table_type = 'BASE TABLE') => ({ table_name, table_type })
const column = (table_name: string, column_name: string, data_type = 'varchar', is_nullable = 'YES') =>
  ({ table_name, column_name, data_type, is_nullable })

/** Answers each statement by the information_schema relation it reads. */
function coordinator(replies: { schemas?: Reply; tables?: Reply; columns?: Reply }) {
  mocks.runTrino.mockImplementation(async (_client: unknown, sql: string) => {
    const reply = /SHOW SCHEMAS/.test(sql)
      ? replies.schemas
      : /information_schema\.tables/.test(sql)
        ? replies.tables
        : /information_schema\.columns/.test(sql)
          ? replies.columns
          : undefined
    if (reply === undefined) throw new Error(`unexpected statement: ${sql}`)
    if (reply instanceof Error) throw reply
    return reply
  })
}

/** Options passed to runTrino for the statement reading `relation`. */
function optionsFor(relation: 'tables' | 'columns') {
  const call = mocks.runTrino.mock.calls.find(([, sql]) =>
    String(sql).includes(`information_schema.${relation}`),
  )
  return call?.[3] as { timeoutMs?: number; maxRows?: number } | undefined
}

const load = (database: string) => fetchSchema('conn-1', 'trino', {} as never, database)

describe('fetchSchema — Trino', () => {
  beforeEach(() => {
    mocks.warn.mockClear()
    mocks.runTrino.mockReset()
  })

  it('merges the table list with its columns, keeping table types', async () => {
    coordinator({
      tables: result([table('orders'), table('big_orders', 'VIEW')]),
      columns: result([
        column('big_orders', 'id', 'bigint'),
        column('orders', 'id', 'bigint', 'NO'),
        column('orders', 'label'),
      ]),
    })

    const { tables } = await load('hive/sales')

    expect(tables).toEqual([
      expect.objectContaining({
        name: 'orders',
        type: 'table',
        columns: [
          { name: 'id', dataType: 'bigint', nullable: false, primaryKey: false },
          { name: 'label', dataType: 'varchar', nullable: true, primaryKey: false },
        ],
      }),
      expect.objectContaining({
        name: 'big_orders',
        type: 'view',
        columns: [{ name: 'id', dataType: 'bigint', nullable: true, primaryKey: false }],
      }),
    ])
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('still lists every table when the columns query fails', async () => {
    coordinator({
      tables: result([table('orders'), table('customers')]),
      columns: new Error('Access Denied: Cannot select from columns'),
    })

    const { tables } = await load('hive/sales')

    expect(tables.map((t) => [t.name, t.columns.length])).toEqual([
      ['orders', 0],
      ['customers', 0],
    ])
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ catalog: 'hive', schema: 'sales', err: 'Access Denied: Cannot select from columns' }),
      expect.stringContaining('serving table names only'),
    )
  })

  it('bounds both introspection queries with a deadline, and caps the columns drain', async () => {
    coordinator({ tables: result([table('orders')]), columns: result([]) })

    await load('hive/sales')

    expect(optionsFor('tables')?.timeoutMs).toBeGreaterThan(0)
    expect(optionsFor('columns')?.timeoutMs).toBeGreaterThan(0)
    expect(optionsFor('columns')?.maxRows).toBeGreaterThan(0)
  })

  it('drops the columns of the table cut by a capped drain', async () => {
    coordinator({
      tables: result([table('a'), table('b')]),
      columns: result([column('a', 'x'), column('a', 'y'), column('b', 'x')], true),
    })

    const { tables } = await load('hive/sales')

    expect(tables.map((t) => [t.name, t.columns.map((c) => c.name)])).toEqual([
      ['a', ['x', 'y']],
      ['b', []],
    ])
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ catalog: 'hive' }),
      expect.stringContaining('column list truncated'),
    )
  })

  it('removes columns a connector lists once per schema of the IN list', async () => {
    coordinator({
      schemas: schemasOf('default', 'shop', 'information_schema'),
      tables: result([table('shop.orders')]),
      columns: result([
        column('shop.orders', 'id'),
        column('shop.orders', 'label'),
        column('shop.orders', 'id'),
        column('shop.orders', 'label'),
      ]),
    })

    const { tables } = await load('memory')

    expect(tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'label'])
  })

  it('qualifies table names and skips system schemas when no schema is pinned', async () => {
    coordinator({
      schemas: schemasOf('information_schema', 'sales', 'hr'),
      tables: result([table('hr.staff'), table('sales.orders')]),
      columns: result([]),
    })

    await load('hive')

    const tablesSql = String(
      mocks.runTrino.mock.calls.find(([, sql]) => String(sql).includes('information_schema.tables'))?.[1],
    )
    expect(tablesSql).toContain(`table_schema IN ('sales', 'hr')`)
    expect(tablesSql).toContain(`table_schema || '.' || table_name`)
    expect(tablesSql).not.toContain(`'information_schema'`)
  })

  it('fails when the table list itself cannot be read', async () => {
    coordinator({ tables: new Error('Délai dépassé (30000 ms) en attendant le coordinateur Trino.') })

    await expect(load('hive/sales')).rejects.toThrow(/Délai dépassé/)
  })

  it('reports a pinned schema that does not exist', async () => {
    coordinator({ tables: result([]), schemas: schemasOf('sales') })

    await expect(load('hive/nope')).rejects.toThrow("Schéma 'nope' introuvable dans le catalogue 'hive'")
  })

  it('returns an empty list for a pinned schema that exists but holds no table', async () => {
    coordinator({ tables: result([]), schemas: schemasOf('Sales'), columns: result([]) })

    await expect(load('hive/sales')).resolves.toEqual({ tables: [], functions: [] })
  })
})
