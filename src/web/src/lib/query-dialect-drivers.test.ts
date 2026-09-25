import { describe, it, expect } from 'vitest'
import {
  deleteRowsStatement,
  exportAsStatements,
  filteredTableQuery,
  insertRowStatement,
  isCellEditable,
  keyColumns,
  previewQuery,
  quoteIdent,
  splitStatementsFor,
  sqlString,
  tableQuery,
  tableRef,
  updateCellStatement,
  updateRowStatements,
} from './query-dialect'
import { splitMssqlStatements } from './mssql-split'
import { likeToGlob, quoteRedisArg, splitRedisCommands } from './redis-command'
import type { FilterRow } from '@/stores/editor.store'

const col = (name: string, dataType = 'text') => ({ name, dataType })
const filter = (column: string, operator: string, value = ''): FilterRow => ({ column, operator, value })

describe('SQL Server dialect', () => {
  it('brackets identifiers and qualifies schema.table', () => {
    expect(quoteIdent('mssql', 'Order Details')).toBe('[Order Details]')
    expect(quoteIdent('mssql', 'odd]name')).toBe('[odd]]name]')
    expect(quoteIdent('mssql', 'CustomerId')).toBe('CustomerId')
    expect(tableRef('mssql', 'sales.Orders')).toBe('sales.Orders')
    expect(tableQuery('mssql', 'sales.Order Lines')).toBe('SELECT * FROM sales.[Order Lines]')
  })

  it('writes Unicode literals and TOP previews', () => {
    expect(sqlString('mssql', "l'été")).toBe("N'l''été'")
    expect(previewQuery('mssql', 'users')).toBe('SELECT TOP 100 * FROM users;')
    expect(updateCellStatement('mssql', 'users', [col('id', 'int')], { id: 1 }, col('name'), 'Zoë')).toBe(
      "UPDATE users SET name = N'Zoë' WHERE id = 1",
    )
  })
})

describe('Snowflake dialect', () => {
  it('quotes anything that Snowflake would not keep as written', () => {
    expect(quoteIdent('snowflake', 'ORDERS')).toBe('ORDERS')
    expect(quoteIdent('snowflake', 'orders')).toBe('"orders"')
    expect(tableRef('snowflake', 'PUBLIC.orders')).toBe('PUBLIC."orders"')
  })

  it('escapes backslashes in string literals', () => {
    expect(sqlString('snowflake', 'C:\\temp')).toBe("'C:\\\\temp'")
  })
})

describe('Redis — key patterns as tables', () => {
  const keyCols = [col('key', 'string'), col('type', 'string'), col('ttl', 'int'), col('size', 'int'), col('value', 'string')]
  const str = { key: 'user:1', type: 'string', ttl: -1, size: 3, value: 'Ada' }
  const hash = { key: 'user:2', type: 'hash', ttl: 60, size: 2, value: null }

  it('browses a pattern with SCAN', () => {
    expect(tableQuery('redis', 'user:*')).toBe('SCAN 0 MATCH user:* COUNT 1000')
    expect(tableQuery('redis', 'odd key*')).toBe('SCAN 0 MATCH "odd key*" COUNT 1000')
    expect(previewQuery('redis', '*')).toBe('SCAN 0 MATCH * COUNT 1000')
  })

  it('identifies rows by their key', () => {
    expect(keyColumns('redis', 'user:*', keyCols, undefined)).toEqual([col('key', 'string')])
  })

  it('only writes cells that can be written back', () => {
    expect(isCellEditable('redis', str, 'value')).toBe(true)
    expect(isCellEditable('redis', hash, 'value')).toBe(false)
    expect(isCellEditable('redis', hash, 'ttl')).toBe(true)
    expect(isCellEditable('redis', str, 'size')).toBe(false)
    expect(isCellEditable('postgresql', str, 'size')).toBe(true)
  })

  it('turns cell edits into commands', () => {
    const keys = [col('key', 'string')]
    expect(updateCellStatement('redis', 'user:*', keys, str, col('value'), 'Ada Lovelace')).toBe('SET user:1 "Ada Lovelace" KEEPTTL')
    expect(updateCellStatement('redis', 'user:*', keys, str, col('ttl'), '300')).toBe('EXPIRE user:1 300')
    expect(updateCellStatement('redis', 'user:*', keys, hash, col('ttl'), null)).toBe('PERSIST user:2')
    expect(updateCellStatement('redis', 'user:*', keys, str, col('key'), 'user:100')).toBe('RENAMENX user:1 user:100')
    expect(updateRowStatements('redis', 'user:*', keys, hash, [
      { column: col('value'), value: 'x' },
      { column: col('ttl'), value: '10' },
    ])).toEqual(['EXPIRE user:2 10'])
  })

  it('inserts string keys without overwriting, and deletes with DEL', () => {
    expect(insertRowStatement('redis', 'user:*', [
      { column: col('key'), value: 'user:3' },
      { column: col('value'), value: 'Grace' },
      { column: col('ttl'), value: '60' },
    ])).toBe('SET user:3 Grace NX EX 60')
    expect(deleteRowsStatement('redis', 'user:*', [col('key')], [str, hash])).toBe('DEL user:1 user:2')
  })

  it('narrows the SCAN with key and type filters', () => {
    expect(filteredTableQuery('redis', 'user:*', [filter('key', 'LIKE', '%42%')], keyCols)).toBe('SCAN 0 MATCH user:*42* COUNT 1000')
    expect(filteredTableQuery('redis', 'user:*', [filter('key', '=', 'user:4*')], keyCols)).toBe('SCAN 0 MATCH "user:4\\\\*" COUNT 1000')
    expect(filteredTableQuery('redis', '*', [filter('type', '=', 'hash')], keyCols)).toBe('SCAN 0 MATCH * TYPE hash COUNT 1000')
  })

  it('exports string keys as SET commands', () => {
    expect(exportAsStatements('redis', 'user:*', [str, { ...str, key: 'user:9', ttl: 30 }, hash], keyCols)).toBe(
      'SET user:1 Ada\nSET user:9 Ada EX 30\n# user:2: hash (use Export → dump)',
    )
  })
})

describe('redis-cli helpers', () => {
  it('splits one command per line, without comments', () => {
    expect(splitRedisCommands('# setup\nSET a 1\n\n// read\nGET a\n')).toEqual(['SET a 1', 'GET a'])
    expect(splitStatementsFor('redis', 'SET a 1\nGET a')).toEqual(['SET a 1', 'GET a'])
  })

  it('quotes arguments like redis-cli', () => {
    expect(quoteRedisArg('user:1')).toBe('user:1')
    expect(quoteRedisArg('a "b"\n')).toBe('"a \\"b\\"\\n"')
    expect(quoteRedisArg('')).toBe('""')
  })

  it('turns LIKE patterns into globs', () => {
    expect(likeToGlob('user_%')).toBe('user?*')
    expect(likeToGlob('a*b')).toBe('a\\*b')
  })
})

describe('splitMssqlStatements', () => {
  it('separates GO batches and splits plain batches on ;', () => {
    expect(splitMssqlStatements('SELECT 1; SELECT 2\nGO\nSELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
    expect(splitStatementsFor('mssql', 'SELECT 1\ngo 2\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('keeps batches with variables or routine bodies whole', () => {
    expect(splitMssqlStatements('DECLARE @n INT = 5;\nSELECT @n;')).toEqual(['DECLARE @n INT = 5;\nSELECT @n'])
    const proc = 'CREATE PROCEDURE p AS\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND'
    expect(splitMssqlStatements(`${proc}\nGO\nEXEC p;`)).toEqual([proc, 'EXEC p'])
  })

  it('still splits transactions, and ignores keywords in strings', () => {
    expect(splitMssqlStatements('BEGIN TRAN; UPDATE t SET a = 1; COMMIT')).toEqual(['BEGIN TRAN', 'UPDATE t SET a = 1', 'COMMIT'])
    expect(splitMssqlStatements("SELECT 'DECLARE @x'; SELECT 2")).toEqual(["SELECT 'DECLARE @x'", 'SELECT 2'])
  })
})
