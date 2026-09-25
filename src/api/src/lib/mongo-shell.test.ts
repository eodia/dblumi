import { describe, it, expect } from 'vitest'
import { BSONRegExp, Decimal128, Long, ObjectId, UUID, Binary, Timestamp } from 'mongodb'
import { parseMongoCommand, MongoShellSyntaxError, type MongoCommand } from './mongo-shell.js'

function collection(cmd: MongoCommand) {
  if (cmd.kind !== 'collection') throw new Error(`expected a collection command, got ${cmd.kind}`)
  return cmd
}

describe('parseMongoCommand — call chain', () => {
  it('parses db.<collection>.<method>(…)', () => {
    const cmd = collection(parseMongoCommand('db.users.find({ age: { $gt: 30 } })'))
    expect(cmd.collection).toBe('users')
    expect(cmd.call.method).toBe('find')
    expect(cmd.call.args).toEqual([{ age: { $gt: 30 } }])
    expect(cmd.chain).toEqual([])
    expect(cmd.database).toBeNull()
  })

  it('collects cursor modifiers in order', () => {
    const cmd = collection(parseMongoCommand('db.users.find({}).sort({ name: 1 }).skip(5).limit(10)'))
    expect(cmd.chain.map((c) => c.method)).toEqual(['sort', 'skip', 'limit'])
    expect(cmd.chain[2]!.args).toEqual([10])
  })

  it('accepts modifiers on following lines', () => {
    const cmd = collection(parseMongoCommand('db.orders\n  .find({ status: "paid" })\n  .sort({ total: -1 })'))
    expect(cmd.collection).toBe('orders')
    expect(cmd.chain[0]!.method).toBe('sort')
  })

  it('treats dotted names as a collection name, like mongosh', () => {
    const cmd = collection(parseMongoCommand('db.system.profile.find()'))
    expect(cmd.collection).toBe('system.profile')
    expect(cmd.call).toEqual({ method: 'find', args: [] })
  })

  it('supports getCollection() and bracket access for unusual names', () => {
    expect(collection(parseMongoCommand("db.getCollection('my-coll').countDocuments()")).collection).toBe('my-coll')
    expect(collection(parseMongoCommand('db["2024 sales"].find()')).collection).toBe('2024 sales')
  })

  it('supports getSiblingDB()', () => {
    const cmd = collection(parseMongoCommand("db.getSiblingDB('analytics').events.find()"))
    expect(cmd.database).toBe('analytics')
    expect(cmd.collection).toBe('events')
  })

  it('parses database-level helpers', () => {
    const cmd = parseMongoCommand('db.getCollectionNames()')
    expect(cmd).toEqual({ kind: 'db', database: null, call: { method: 'getCollectionNames', args: [] }, chain: [] })
    const run = parseMongoCommand('db.runCommand({ ping: 1 })')
    expect(run.kind === 'db' && run.call.args).toEqual([{ ping: 1 }])
  })

  it('parses show dbs / show collections', () => {
    expect(parseMongoCommand('show dbs')).toEqual({ kind: 'show', target: 'dbs' })
    expect(parseMongoCommand('show databases;')).toEqual({ kind: 'show', target: 'dbs' })
    expect(parseMongoCommand('show collections')).toEqual({ kind: 'show', target: 'collections' })
  })

  it('accepts a trailing semicolon and comments', () => {
    const cmd = collection(parseMongoCommand('// active users\ndb.users.find({ active: true }) /* all */ ;'))
    expect(cmd.call.args).toEqual([{ active: true }])
  })
})

describe('parseMongoCommand — rejected input', () => {
  const rejects = (src: string, message?: RegExp) => {
    expect(() => parseMongoCommand(src)).toThrow(MongoShellSyntaxError)
    if (message) expect(() => parseMongoCommand(src)).toThrow(message)
  }

  it('rejects anything that is not a db.… expression', () => {
    rejects('users.find()', /commence par db\./)
    rejects('var x = 1', /commence par db\./)
    rejects('require("child_process")', /commence par db\./)
  })

  it('rejects use <db> with a pointer to the switcher', () => {
    rejects('use admin', /getSiblingDB/)
  })

  it('rejects variables, functions and expressions inside arguments', () => {
    rejects('db.users.find({ a: x })', /variables/)
    rejects('db.users.find({ $where: function () { return true } })')
    rejects('db.users.find({ a: 1 + 1 })')
    rejects('db.users.find({ a: `${process.env.SECRET}` })', /templates/)
  })

  it('rejects unknown constructors', () => {
    rejects('db.users.find({ a: eval("1") })', /non supportée/)
  })

  it('rejects several statements in one run', () => {
    rejects('db.a.find(); db.b.find()', /Une seule commande/)
  })

  it('requires a method call', () => {
    rejects('db.users', /Appel de méthode attendu/)
  })

  it('reports syntax errors with a position', () => {
    try {
      parseMongoCommand('db.users.find({ a: 1')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MongoShellSyntaxError)
      expect((err as MongoShellSyntaxError).message).toMatch(/position \d+/)
    }
  })

  it('never lets __proto__ re-parent a parsed object', () => {
    const cmd = collection(parseMongoCommand('db.c.insertOne({ "__proto__": { polluted: true } })'))
    const doc = cmd.call.args[0] as Record<string, unknown>
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype)
    expect(Object.keys(doc)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('parseMongoCommand — values', () => {
  const arg = (literal: string) => collection(parseMongoCommand(`db.c.find(${literal})`)).call.args[0]

  it('parses JSON and relaxed JS object literals', () => {
    expect(arg(`{ "a": 1, 'b': 'x', c: [1, 2, 3,], d: null, e: true, }`)).toEqual({
      a: 1, b: 'x', c: [1, 2, 3], d: null, e: true,
    })
  })

  it('parses numbers in every JS notation', () => {
    expect(arg('[-1, +2, 3.5, .5, 1e3, 0x1f, 0b11, 0o7, -Infinity, NaN]')).toEqual([
      -1, 2, 3.5, 0.5, 1000, 31, 3, 7, -Infinity, NaN,
    ])
  })

  it('decodes string escapes', () => {
    expect(arg(`"a\\n\\t\\"b\\" \\u00e9 \\u{1F600} \\x41"`)).toBe('a\n\t"b" é 😀 A')
  })

  it('builds BSON values from mongosh helpers', () => {
    const hex = '65f1c0ffee0000000000abcd'
    const v = arg(`{
      id: ObjectId("${hex}"),
      at: ISODate("2024-01-02T03:04:05Z"),
      d: new Date("2024-01-01"),
      l: NumberLong("9007199254740993"),
      dec: NumberDecimal("1.10"),
      u: UUID("123e4567-e89b-12d3-a456-426614174000"),
      ts: Timestamp(1700000000, 2),
    }`) as Record<string, unknown>
    expect((v['id'] as ObjectId).toHexString()).toBe(hex)
    expect(v['at']).toEqual(new Date('2024-01-02T03:04:05Z'))
    expect(v['d']).toBeInstanceOf(Date)
    expect((v['l'] as Long).toString()).toBe('9007199254740993')
    expect((v['dec'] as Decimal128).toString()).toBe('1.10')
    expect((v['u'] as Binary).sub_type).toBe(Binary.SUBTYPE_UUID)
    expect(v['u']).toBeInstanceOf(UUID)
    expect((v['ts'] as Timestamp).t).toBe(1700000000)
  })

  it('rejects an invalid ObjectId or date', () => {
    expect(() => arg('ObjectId("nope")')).toThrow(/ObjectId invalide/)
    expect(() => arg('ISODate("not a date")')).toThrow(/Date invalide/)
  })

  it('parses regex literals, including slashes inside character classes', () => {
    const r = arg('{ name: /^jo[/]hn/i }') as { name: BSONRegExp }
    expect(r.name).toBeInstanceOf(BSONRegExp)
    expect(r.name.pattern).toBe('^jo[/]hn')
    expect(r.name.options).toBe('i')
  })

  it('does not confuse comments with regex literals', () => {
    expect(arg('{ a: 1, // first field\n b: /* inline */ 2 }')).toEqual({ a: 1, b: 2 })
  })

  it('turns single-key Extended JSON objects into BSON values', () => {
    const v = arg('{ _id: { "$oid": "65f1c0ffee0000000000abcd" }, at: { "$date": "2024-01-01T00:00:00Z" }, n: { "$numberLong": "42" } }') as Record<string, unknown>
    expect(v['_id']).toBeInstanceOf(ObjectId)
    expect(v['at']).toEqual(new Date('2024-01-01T00:00:00Z'))
    expect(v['n']).toBeInstanceOf(Long)
  })

  it('keeps query operators untouched', () => {
    expect(arg('{ tags: { $in: ["a"] }, $or: [{ a: 1 }] }')).toEqual({ tags: { $in: ['a'] }, $or: [{ a: 1 }] })
  })
})
