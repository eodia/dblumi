import { describe, expect, it } from 'vitest'

import {
  TRINO_DEFAULT_PORT,
  createTrinoClient,
  parseTrinoTarget,
  quoteTrinoIdent,
  quoteTrinoString,
  quoteTrinoTable,
  toTrinoConnectionError,
} from './trino.js'
import { injectTrinoLimit } from './query-executor.js'
import { detectGuardrail } from './guardrail.js'

// Pure functions only — these tests never reach the network and need no
// Trino coordinator.

describe('parseTrinoTarget', () => {
  it('returns an empty target for undefined / null / empty input', () => {
    expect(parseTrinoTarget()).toEqual({})
    expect(parseTrinoTarget(undefined)).toEqual({})
    expect(parseTrinoTarget(null)).toEqual({})
    expect(parseTrinoTarget('')).toEqual({})
    expect(parseTrinoTarget('   ')).toEqual({})
  })

  it('never emits explicit undefined properties (exactOptionalPropertyTypes)', () => {
    expect(Object.keys(parseTrinoTarget(''))).toEqual([])
    expect(Object.keys(parseTrinoTarget('hive'))).toEqual(['catalog'])
  })

  it('parses a bare catalog', () => {
    expect(parseTrinoTarget('hive')).toEqual({ catalog: 'hive' })
    expect(parseTrinoTarget('  hive  ')).toEqual({ catalog: 'hive' })
  })

  it('parses "catalog/schema"', () => {
    expect(parseTrinoTarget('hive/default')).toEqual({ catalog: 'hive', schema: 'default' })
  })

  it('parses "catalog.schema"', () => {
    expect(parseTrinoTarget('hive.default')).toEqual({ catalog: 'hive', schema: 'default' })
  })

  it('strips surrounding double quotes on each segment', () => {
    expect(parseTrinoTarget('"hive"/"default"')).toEqual({ catalog: 'hive', schema: 'default' })
    expect(parseTrinoTarget('"hive"')).toEqual({ catalog: 'hive' })
  })

  it('filters out empty segments', () => {
    expect(parseTrinoTarget('hive//default')).toEqual({ catalog: 'hive', schema: 'default' })
    expect(parseTrinoTarget('/hive/')).toEqual({ catalog: 'hive' })
    expect(parseTrinoTarget('//')).toEqual({})
  })

  it('ignores extra segments beyond catalog and schema', () => {
    expect(parseTrinoTarget('hive/default/extra')).toEqual({ catalog: 'hive', schema: 'default' })
  })

  it('folds unquoted identifiers to lower case (Trino rule)', () => {
    expect(parseTrinoTarget('HIVE/DEFAULT')).toEqual({ catalog: 'hive', schema: 'default' })
    expect(parseTrinoTarget('Hive.Default')).toEqual({ catalog: 'hive', schema: 'default' })
  })

  it('keeps the case of a quoted identifier', () => {
    expect(parseTrinoTarget('"Hive"/"MySchema"')).toEqual({
      catalog: 'Hive',
      schema: 'MySchema',
    })
  })
})

describe('quoteTrinoIdent', () => {
  it('wraps in double quotes', () => {
    expect(quoteTrinoIdent('tbl')).toBe('"tbl"')
  })

  it('doubles embedded double quotes', () => {
    expect(quoteTrinoIdent('a"b')).toBe('"a""b"')
  })
})

describe('quoteTrinoString', () => {
  it('wraps in single quotes', () => {
    expect(quoteTrinoString('default')).toBe("'default'")
  })

  it('doubles embedded single quotes', () => {
    expect(quoteTrinoString("a'b")).toBe("'a''b'")
  })
})

describe('quoteTrinoTable', () => {
  it('quotes a bare table name', () => {
    expect(quoteTrinoTable('tbl')).toBe('"tbl"')
  })

  it('quotes each segment of a qualified name', () => {
    expect(quoteTrinoTable('sch.tbl')).toBe('"sch"."tbl"')
    expect(quoteTrinoTable('hive.sch.tbl')).toBe('"hive"."sch"."tbl"')
  })

  it('never quotes the whole string at once', () => {
    expect(quoteTrinoTable('sch.tbl')).not.toBe('"sch.tbl"')
  })

  it('escapes double quotes inside a segment', () => {
    expect(quoteTrinoTable('a"b.c')).toBe('"a""b"."c"')
  })
})

describe('injectTrinoLimit', () => {
  it('appends LIMIT to a plain SELECT', () => {
    expect(injectTrinoLimit('SELECT * FROM t', 100)).toBe('SELECT * FROM t\nLIMIT 100')
  })

  it('strips a trailing semicolon', () => {
    expect(injectTrinoLimit('SELECT 1;', 10)).toBe('SELECT 1\nLIMIT 10')
  })

  it('handles WITH (CTE) statements', () => {
    const sql = 'WITH x AS (SELECT 1 AS a) SELECT * FROM x'
    expect(injectTrinoLimit(sql, 10)).toBe(`${sql}\nLIMIT 10`)
  })

  it('leaves non-SELECT statements untouched apart from the semicolon', () => {
    expect(injectTrinoLimit('INSERT INTO t VALUES (1);', 100)).toBe('INSERT INTO t VALUES (1)')
    expect(injectTrinoLimit('SHOW CATALOGS', 100)).toBe('SHOW CATALOGS')
  })

  it('emits OFFSET BEFORE LIMIT (Trino grammar)', () => {
    const out = injectTrinoLimit('SELECT * FROM t', 50, 100)
    expect(out).toBe('SELECT * FROM t\nOFFSET 100\nLIMIT 50')
    expect(out.indexOf('OFFSET')).toBeLessThan(out.indexOf('LIMIT'))
    expect(out).not.toMatch(/LIMIT\s+\d+\s+OFFSET/i)
  })

  it('omits OFFSET on the first page', () => {
    expect(injectTrinoLimit('SELECT * FROM t', 50, 0)).not.toContain('OFFSET')
  })

  it('keeps the smaller of the user LIMIT and the pagination limit', () => {
    expect(injectTrinoLimit('SELECT * FROM t LIMIT 5', 100)).toBe('SELECT * FROM t\nLIMIT 5')
    expect(injectTrinoLimit('SELECT * FROM t LIMIT 500', 100)).toBe('SELECT * FROM t\nLIMIT 100')
  })

  it('pages inside the user OFFSET instead of discarding it', () => {
    // The user's result set starts at row 10: grid page 3 (offset 40) is row 50.
    const out = injectTrinoLimit('SELECT * FROM t OFFSET 10', 20, 40)
    expect(out).toBe('SELECT * FROM t\nOFFSET 50\nLIMIT 20')
    expect(out).not.toContain('OFFSET 10')
  })

  it('never pages past the user LIMIT', () => {
    expect(injectTrinoLimit('SELECT * FROM t LIMIT 150', 100, 100)).toBe('SELECT * FROM t\nOFFSET 100\nLIMIT 50')
  })

  it('keeps the user OFFSET when the grid asks for page 1', () => {
    expect(injectTrinoLimit('SELECT * FROM t OFFSET 10 ROWS', 20)).toBe(
      'SELECT * FROM t\nOFFSET 10\nLIMIT 20',
    )
    expect(injectTrinoLimit('SELECT * FROM t OFFSET 10', 10000)).toBe(
      'SELECT * FROM t\nOFFSET 10',
    )
  })

  it('never emits two LIMIT clauses when a CTE or subquery carries one', () => {
    expect(injectTrinoLimit('WITH a AS (SELECT * FROM t LIMIT 5) SELECT * FROM a LIMIT 3', 100)).toBe(
      'WITH a AS (SELECT * FROM t LIMIT 5) SELECT * FROM a\nLIMIT 3',
    )
    expect(injectTrinoLimit('SELECT * FROM (SELECT * FROM t LIMIT 5) x LIMIT 3', 100)).toBe(
      'SELECT * FROM (SELECT * FROM t LIMIT 5) x\nLIMIT 3',
    )
  })

  it('leaves an inner LIMIT in place when the statement has no trailing one', () => {
    expect(injectTrinoLimit('SELECT * FROM (SELECT * FROM t LIMIT 5) x', 100)).toBe(
      'SELECT * FROM (SELECT * FROM t LIMIT 5) x\nLIMIT 100',
    )
  })

  it('never mutilates a LIMIT / OFFSET inside a string literal', () => {
    expect(injectTrinoLimit("SELECT * FROM t WHERE name LIKE '%LIMIT 5%'", 1000)).toBe(
      "SELECT * FROM t WHERE name LIKE '%LIMIT 5%'\nLIMIT 1000",
    )
  })

  it('replaces FETCH FIRST instead of adding an exclusive LIMIT next to it', () => {
    // Trino grammar: LIMIT and FETCH FIRST are alternatives, never both.
    expect(injectTrinoLimit('SELECT * FROM t ORDER BY a FETCH FIRST 1 ROW ONLY', 1000)).toBe(
      'SELECT * FROM t ORDER BY a\nLIMIT 1',
    )
    expect(injectTrinoLimit('SELECT * FROM t FETCH NEXT 50 ROWS ONLY', 10)).toBe(
      'SELECT * FROM t\nLIMIT 10',
    )
    expect(
      injectTrinoLimit('SELECT * FROM t ORDER BY a FETCH FIRST 3 ROWS WITH TIES', 1000),
    ).not.toMatch(/FETCH/i)
  })

  it('does not inject anything for the 10000 "all" sentinel', () => {
    expect(injectTrinoLimit('SELECT * FROM t', 10000)).toBe('SELECT * FROM t')
    expect(injectTrinoLimit('SELECT * FROM t', 10000)).not.toContain('LIMIT')
  })

  it('still honours a user LIMIT under the 10000 sentinel', () => {
    expect(injectTrinoLimit('SELECT * FROM t LIMIT 7', 10000)).toBe('SELECT * FROM t\nLIMIT 7')
  })

  it('never emits the MySQL "LIMIT m, n" form', () => {
    expect(injectTrinoLimit('SELECT * FROM t', 10, 5)).not.toMatch(/LIMIT\s+\d+\s*,/)
  })
})

describe('toTrinoConnectionError', () => {
  it('maps HTTP statuses to explicit French messages', () => {
    const at = 'http://trino:8080'
    expect(
      toTrinoConnectionError({ isAxiosError: true, response: { status: 401 } }, at).message,
    ).toContain('Authentification refusée')
    expect(
      toTrinoConnectionError({ isAxiosError: true, response: { status: 403 } }, at).message,
    ).toContain('Accès refusé')
    expect(
      toTrinoConnectionError({ isAxiosError: true, response: { status: 502 } }, at).message,
    ).toContain('HTTP 502')
  })

  it('maps transport error codes', () => {
    const at = 'http://trino:8080'
    expect(toTrinoConnectionError({ isAxiosError: true, code: 'ECONNREFUSED' }, at).message).toContain(
      'Connexion refusée',
    )
    expect(toTrinoConnectionError({ isAxiosError: true, code: 'ENOTFOUND' }, at).message).toContain(
      'Hôte introuvable',
    )
  })

  it('returns non-axios errors untouched', () => {
    const err = new Error('boom')
    expect(toTrinoConnectionError(err, 'x')).toBe(err)
  })

  it('keys off isAxiosError, not err.name (axios errors are named "Error")', () => {
    // Regression guard: testing `err.name === 'AxiosError'` would make the whole
    // mapping inert, because axios errors keep `name === 'Error'`.
    const impostor = Object.assign(new Error('nope'), { name: 'AxiosError' })
    expect(toTrinoConnectionError(impostor, 'x')).toBe(impostor)
  })
})

describe('createTrinoClient', () => {
  // `Trino.create()` performs no I/O — it only builds an axios client config.
  const configOf = (client: unknown) =>
    (client as { client: { clientConfig: { baseURL: string; auth?: unknown; headers: Record<string, unknown> } } })
      .client.clientConfig

  it('builds an http server URL on the default port', () => {
    const cfg = configOf(createTrinoClient({ host: 'coord' }))
    expect(cfg.baseURL).toBe(`http://coord:${TRINO_DEFAULT_PORT}`)
  })

  it('switches to https when ssl is set', () => {
    const cfg = configOf(createTrinoClient({ host: 'coord', port: 8443, ssl: true }))
    expect(cfg.baseURL).toBe('https://coord:8443')
  })

  it('strips a scheme pasted into the host field and brackets bare IPv6', () => {
    expect(configOf(createTrinoClient({ host: 'https://coord/' })).baseURL).toBe(
      `http://coord:${TRINO_DEFAULT_PORT}`,
    )
    expect(configOf(createTrinoClient({ host: '::1' })).baseURL).toBe(
      `http://[::1]:${TRINO_DEFAULT_PORT}`,
    )
  })

  it('sends X-Trino-User and no Basic auth when the password is empty', () => {
    const cfg = configOf(createTrinoClient({ host: 'coord', username: 'marc', password: '' }))
    expect(cfg.auth).toBeUndefined()
    expect(cfg.headers['X-Trino-User']).toBe('marc')
  })

  it('never lets X-Trino-User be dropped by an empty username', () => {
    // trino-client removes falsy headers, and a request with neither
    // X-Trino-User nor Authorization is answered with a 401.
    const cfg = configOf(createTrinoClient({ host: 'coord', username: '   ' }))
    expect(cfg.headers['X-Trino-User']).toBeTruthy()
  })

  it('uses Basic auth as soon as a password is present', () => {
    const cfg = configOf(createTrinoClient({ host: 'coord', username: 'marc', password: 'pwd' }))
    expect(cfg.auth).toEqual({ username: 'marc', password: 'pwd' })
  })

  it('pins catalog and schema from the connection target', () => {
    const cfg = configOf(createTrinoClient({ host: 'coord', database: 'hive/default' }))
    expect(cfg.headers['X-Trino-Catalog']).toBe('hive')
    expect(cfg.headers['X-Trino-Schema']).toBe('default')
  })
})

describe('constants', () => {
  it('defaults to the Trino HTTP port', () => {
    expect(TRINO_DEFAULT_PORT).toBe(8080)
  })
})

describe('detectGuardrail — Trino statements', () => {
  it('reports USE for what it is instead of "unrecognised statement"', () => {
    const result = detectGuardrail('USE tpch.sf1')
    // USE re-binds the shared client (Trino answers with X-Trino-Set-Schema),
    // so it is confirmed rather than silently run — but with an honest label.
    expect(result.level).toBe(2)
    expect(result).toMatchObject({ message: expect.stringContaining('USE') })
  })

  it('keeps read-only Trino statements at level 0', () => {
    expect(detectGuardrail('DESCRIBE nation').level).toBe(0)
    expect(detectGuardrail('VALUES (1, 2), (3, 4)').level).toBe(0)
    expect(detectGuardrail('SHOW CATALOGS').level).toBe(0)
  })

  it('labels MERGE as a merge, not as an UPDATE without WHERE', () => {
    const result = detectGuardrail('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = 1')
    expect(result).toMatchObject({ level: 2, message: expect.stringContaining('MERGE') })
  })

  it('treats CALL <catalog>.system.<proc> as a dangerous operation', () => {
    expect(detectGuardrail('CALL iceberg.system.expire_snapshots()').level).toBe(3)
  })
})
