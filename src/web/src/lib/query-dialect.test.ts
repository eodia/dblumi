import { describe, it, expect } from 'vitest'
import {
  deleteRowsStatement,
  dropStatement,
  explainToggle,
  exportAsStatements,
  filteredTableQuery,
  insertRowStatement,
  keyColumns,
  mongoLiteral,
  quoteIdent,
  splitStatementsFor,
  tableQuery,
  updateCellStatement,
} from './query-dialect'
import { splitMongoStatements } from './mongo-split'
import { splitSqlStatements } from './sql-split'

const col = (name: string, dataType = 'text') => ({ name, dataType })

describe('quoteIdent / tableQuery', () => {
  it('quotes only when needed, per dialect', () => {
    expect(quoteIdent('postgresql', 'orders')).toBe('orders')
    expect(quoteIdent('postgresql', 'user')).toBe('"user"') // bare `user` is current_user
    expect(quoteIdent('postgresql', 'OrderItems')).toBe('"OrderItems"')
    expect(quoteIdent('mysql', 'OrderItems')).toBe('OrderItems')
    expect(quoteIdent('mysql', 'order')).toBe('`order`')
    expect(quoteIdent('oracle', 'EMP')).toBe('EMP')
    expect(quoteIdent('oracle', 'emp')).toBe('"emp"')
    expect(quoteIdent('postgresql', 'a"b')).toBe('"a""b"')
  })

  it('builds the table tab query', () => {
    expect(tableQuery('postgresql', 'user')).toBe('SELECT * FROM "user"')
    expect(tableQuery('trino', 'sales.orders')).toBe('SELECT * FROM sales.orders')
    expect(tableQuery('mongodb', 'users')).toBe('db.users.find({})')
    expect(tableQuery('mongodb', 'my-coll')).toBe('db.getCollection("my-coll").find({})')
    expect(tableQuery('mongodb', 'stats')).toBe('db.getCollection("stats").find({})')
  })

  it('drops through the dialect', () => {
    expect(dropStatement('mongodb', 'table', 'logs')).toBe('db.logs.drop()')
    expect(dropStatement('mysql', 'view', 'v total')).toBe('DROP VIEW `v total`')
  })
})

describe('keyColumns', () => {
  const columns = [col('order_id', 'int4'), col('line', 'int4'), col('qty', 'int4')]

  it('uses the declared (composite) primary key', () => {
    const schema = [{ name: 'order_items', columns: [
      { name: 'order_id', dataType: 'integer', nullable: false, primaryKey: true },
      { name: 'line', dataType: 'integer', nullable: false, primaryKey: true },
      { name: 'qty', dataType: 'integer', nullable: true, primaryKey: false },
    ] }]
    expect(keyColumns('postgresql', 'order_items', columns, schema)?.map((c) => c.name)).toEqual(['order_id', 'line'])
  })

  it('never falls back to the first column', () => {
    expect(keyColumns('postgresql', 'order_items', columns, [])).toBeNull()
    expect(keyColumns('postgresql', 't', [col('ID'), col('a')], [])?.map((c) => c.name)).toEqual(['ID'])
  })

  it('uses _id on MongoDB', () => {
    expect(keyColumns('mongodb', 'users', [col('_id', 'objectId'), col('name', 'string')], undefined)?.[0]?.name).toBe('_id')
  })
})

describe('grid statements — SQL', () => {
  const keys = [col('order_id', 'int4'), col('line', 'int4')]
  const row = { order_id: 7, line: 2, note: "it's" }

  it('updates one cell through the full key, with escaped values', () => {
    expect(updateCellStatement('postgresql', 'order_items', keys, row, col('note'), "l'été")).toBe(
      `UPDATE order_items SET note = 'l''été' WHERE order_id = 7 AND line = 2`,
    )
    expect(updateCellStatement('mysql', 'order_items', keys, row, col('note'), 'a\\b')).toBe(
      `UPDATE order_items SET note = 'a\\\\b' WHERE order_id = 7 AND line = 2`,
    )
    expect(updateCellStatement('postgresql', 't', [col('id')], { id: 'x' }, col('note'), null)).toBe(
      `UPDATE t SET note = NULL WHERE id = 'x'`,
    )
  })

  it('deletes by key: IN list for a simple key, OR of predicates for a composite one', () => {
    expect(deleteRowsStatement('postgresql', 't', [col('id')], [{ id: 1 }, { id: 2 }])).toBe('DELETE FROM t WHERE id IN (1, 2)')
    expect(deleteRowsStatement('postgresql', 'order_items', keys, [row, { order_id: 8, line: 1 }])).toBe(
      'DELETE FROM order_items WHERE (order_id = 7 AND line = 2) OR (order_id = 8 AND line = 1)',
    )
  })

  it('inserts with quoted identifiers and NULL kept as a keyword', () => {
    expect(insertRowStatement('postgresql', 'Users', [{ column: col('Full Name'), value: 'Ada' }, { column: col('age'), value: 'NULL' }])).toBe(
      `INSERT INTO "Users" ("Full Name", age) VALUES ('Ada', NULL)`,
    )
  })

  it('filters with quoted columns', () => {
    expect(filteredTableQuery('postgresql', 't', [{ column: 'Status', operator: '=', value: "o'k" }, { column: 'x', operator: 'IS NULL', value: '' }], [])).toBe(
      `SELECT * FROM t WHERE "Status" = 'o''k' AND x IS NULL`,
    )
  })
})

describe('grid statements — MongoDB', () => {
  const id = col('_id', 'objectId')
  const row = { _id: '65f1c0ffee0000000000abcd', age: 3 }

  it('updates a field of the document, typed from the column', () => {
    expect(updateCellStatement('mongodb', 'users', [id], row, col('age', 'int'), '42')).toBe(
      'db.users.updateOne({ _id: ObjectId("65f1c0ffee0000000000abcd") }, { $set: { "age": 42 } })',
    )
    expect(updateCellStatement('mongodb', 'users', [id], row, col('at', 'date'), '2024-01-01T00:00:00Z')).toBe(
      'db.users.updateOne({ _id: ObjectId("65f1c0ffee0000000000abcd") }, { $set: { "at": ISODate("2024-01-01T00:00:00.000Z") } })',
    )
  })

  it('writes typed literals', () => {
    expect(mongoLiteral('9007199254740993', 'long')).toBe('NumberLong("9007199254740993")')
    expect(mongoLiteral('1.10', 'decimal')).toBe('NumberDecimal("1.10")')
    expect(mongoLiteral('true', 'bool')).toBe('true')
    expect(mongoLiteral('{"a":{"$oid":"65f1c0ffee0000000000abcd"}}', 'object')).toBe('{"a":{"$oid":"65f1c0ffee0000000000abcd"}}')
    expect(mongoLiteral('not json', 'object')).toBe('"not json"')
    expect(mongoLiteral('abc', 'int')).toBe('"abc"')
    expect(mongoLiteral(null, 'string')).toBe('null')
  })

  it('deletes by _id and keeps nested Extended JSON ids', () => {
    expect(deleteRowsStatement('mongodb', 'users', [id], [row])).toBe(
      'db.users.deleteMany({ _id: { $in: [ObjectId("65f1c0ffee0000000000abcd")] } })',
    )
    expect(deleteRowsStatement('mongodb', 'users', [col('_id', 'object')], [{ _id: { a: 1 } }])).toBe(
      'db.users.deleteMany({ _id: { $in: [{"a":1}] } })',
    )
  })

  it('turns grid filters into a find filter', () => {
    expect(filteredTableQuery('mongodb', 'users', [
      { column: 'name', operator: 'LIKE', value: 'Ad%' },
      { column: 'age', operator: '>=', value: '30' },
      { column: 'deleted', operator: 'IS NULL', value: '' },
    ], [col('age', 'int')])).toBe(
      'db.users.find({ $and: [{ "name": { $regex: "^Ad.*$" } }, { "age": { $gte: 30 } }, { "deleted": null }] })',
    )
  })

  it('exports as an insertMany script', () => {
    expect(exportAsStatements('mongodb', 'users', [row], [id, col('age', 'int')])).toBe(
      'db.users.insertMany([\n  { "_id": ObjectId("65f1c0ffee0000000000abcd"), "age": 3 }\n])',
    )
  })
})

describe('explainToggle', () => {
  it('toggles EXPLAIN in SQL and .explain() in mongosh', () => {
    expect(explainToggle('postgresql', 'SELECT 1;')).toEqual({ explaining: false, next: 'EXPLAIN SELECT 1' })
    expect(explainToggle('postgresql', 'EXPLAIN SELECT 1')).toEqual({ explaining: true, next: 'SELECT 1' })
    expect(explainToggle('oracle', 'SELECT 1 FROM dual')).toEqual({ explaining: false, next: 'EXPLAIN PLAN FOR SELECT 1 FROM dual' })
    expect(explainToggle('mongodb', 'db.u.find({})')).toEqual({ explaining: false, next: 'db.u.find({}).explain()' })
    expect(explainToggle('mongodb', 'db.u.find({}).explain("executionStats")')).toEqual({ explaining: true, next: 'db.u.find({})' })
  })
})

describe('statement splitting', () => {
  it('splits mongosh on ; and on lines that start a new command', () => {
    expect(splitMongoStatements('db.a.find({})\ndb.b.find({ x: ";" })')).toEqual(['db.a.find({})', 'db.b.find({ x: ";" })'])
    expect(splitMongoStatements('db.a.find({}); db.b.countDocuments()')).toEqual(['db.a.find({})', 'db.b.countDocuments()'])
  })

  it('keeps chained calls, multi-line documents, regexes and comments together', () => {
    const chained = 'db.a.find({\n  name: /;db\\./i, // ; not a separator\n})\n  .sort({ x: 1 })'
    expect(splitMongoStatements(chained)).toEqual([chained])
    // A comment alone is never a statement; one after a command stays with it (the API skips it).
    expect(splitMongoStatements('// just a comment\ndb.a.find()\n/* trailing */')).toEqual(['db.a.find()\n/* trailing */'])
    expect(splitMongoStatements('db.a.find()\n// the end')).toEqual(['db.a.find()\n// the end'])
  })

  it('drops SQL pieces made only of comments', () => {
    expect(splitSqlStatements('SELECT 1;\n-- done')).toEqual(['SELECT 1'])
    expect(splitStatementsFor('postgresql', 'SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitStatementsFor('mongodb', 'db.a.find()\ndb.b.find()')).toHaveLength(2)
  })
})
