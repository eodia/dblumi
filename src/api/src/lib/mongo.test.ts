import { describe, it, expect, vi } from 'vitest'
import { Binary, Decimal128, Long, ObjectId, Timestamp, UUID, BSONRegExp } from 'mongodb'

// mongo.ts logs through ../logger.js, which validates process.env at import time.
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const {
  buildMongoClientConfig,
  detectMongoGuardrail,
  documentsToResult,
  inferFields,
  mongoPage,
  splitMongoHostCredentials,
  toCellValue,
  toShellLiteral,
} = await import('./mongo.js')
const { parseMongoCommand } = await import('./mongo-shell.js')

const guard = (src: string) => detectMongoGuardrail(parseMongoCommand(src))

describe('splitMongoHostCredentials', () => {
  it('moves credentials out of a URI host', () => {
    expect(splitMongoHostCredentials('mongodb+srv://al%40ice:p%3Ass@cluster0.example.net/?retryWrites=true')).toEqual({
      host: 'mongodb+srv://cluster0.example.net/?retryWrites=true',
      username: 'al@ice',
      password: 'p:ss',
    })
  })

  it('keeps multi-host URIs and their options intact', () => {
    expect(splitMongoHostCredentials('mongodb://u:p@h1:27017,h2:27018/?replicaSet=rs0').host).toBe(
      'mongodb://h1:27017,h2:27018/?replicaSet=rs0',
    )
  })

  it('splits at the last @, so an unescaped @ or / in the password never stays in the host', () => {
    expect(splitMongoHostCredentials('mongodb://u:p@ss/w0rd@h1:27017/db?authSource=admin')).toEqual({
      host: 'mongodb://h1:27017/db?authSource=admin',
      username: 'u',
      password: 'p@ss/w0rd',
    })
  })

  it('leaves plain hosts and credential-free URIs alone', () => {
    expect(splitMongoHostCredentials('db.internal')).toEqual({ host: 'db.internal' })
    expect(splitMongoHostCredentials('mongodb://h:27017/')).toEqual({ host: 'mongodb://h:27017/' })
  })
})

describe('buildMongoClientConfig', () => {
  it('connects directly to a single plain host', () => {
    const { uri, options } = buildMongoClientConfig({ driver: 'mongodb', host: 'localhost', port: 27018, username: 'root', password: 'x', ssl: true })
    expect(uri).toBe('mongodb://localhost:27018/')
    expect(options.directConnection).toBe(true)
    expect(options.tls).toBe(true)
    expect(options.auth).toEqual({ username: 'root', password: 'x' })
  })

  it('defaults to port 27017 and brackets IPv6 hosts', () => {
    expect(buildMongoClientConfig({ driver: 'mongodb', host: '::1' }).uri).toBe('mongodb://[::1]:27017/')
  })

  it('uses a URI host as is, without auth when no username is set', () => {
    const { uri, options } = buildMongoClientConfig({ driver: 'mongodb', host: 'mongodb+srv://c.example.net/?authSource=admin' })
    expect(uri).toBe('mongodb+srv://c.example.net/?authSource=admin')
    expect(options.directConnection).toBeUndefined()
    expect(options.auth).toBeUndefined()
  })

  it('never uses credentials left inside a stored URI', () => {
    const { uri } = buildMongoClientConfig({ driver: 'mongodb', host: 'mongodb://leak:me@h:1/' })
    expect(uri).toBe('mongodb://h:1/')
  })
})

describe('toCellValue', () => {
  const oid = new ObjectId('65f1c0ffee0000000000abcd')

  it('renders top-level BSON scalars readably', () => {
    expect(toCellValue(oid)).toBe('65f1c0ffee0000000000abcd')
    expect(toCellValue(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01T00:00:00.000Z')
    expect(toCellValue(Decimal128.fromString('1.10'))).toBe('1.10')
    expect(toCellValue(Long.fromNumber(42))).toBe(42)
    expect(toCellValue(Long.fromString('9007199254740993'))).toBe('9007199254740993')
    expect(toCellValue(new UUID('123e4567-e89b-12d3-a456-426614174000'))).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(toCellValue(new Binary(Buffer.from('ab')))).toBe('YWI=')
    expect(toCellValue(new Timestamp({ t: 5, i: 1 }))).toBe('Timestamp(5, 1)')
    expect(toCellValue(new BSONRegExp('^a', 'i'))).toBe('/^a/i')
    expect(toCellValue(NaN)).toBe('NaN')
  })

  it('keeps an Extended JSON shape for nested values, so they parse back to BSON', () => {
    const cell = toCellValue({ ref: oid, at: new Date(0), big: Long.fromString('9007199254740993'), n: 1 })
    expect(cell).toEqual({
      ref: { $oid: '65f1c0ffee0000000000abcd' },
      at: { $date: '1970-01-01T00:00:00.000Z' },
      big: { $numberLong: '9007199254740993' },
      n: 1,
    })
    // …and the grid's JSON text round-trips through the shell parser.
    const cmd = parseMongoCommand(`db.c.updateOne({}, { $set: { x: ${JSON.stringify(cell)} } })`)
    const set = (cmd.kind === 'collection' ? cmd.call.args[1] : {}) as { $set: { x: Record<string, unknown> } }
    expect(set.$set.x['ref']).toBeInstanceOf(ObjectId)
    expect(set.$set.x['at']).toBeInstanceOf(Date)
    expect(set.$set.x['big']).toBeInstanceOf(Long)
  })
})

describe('documentsToResult', () => {
  it('builds the union of fields, _id first, with widened numeric types', () => {
    const { columns, rows } = documentsToResult([
      { name: 'a', score: 1, _id: new ObjectId() },
      { _id: new ObjectId(), score: 2.5, tags: ['x'] },
      { _id: 'custom', name: null },
    ])
    expect(columns.map((c) => c.name)).toEqual(['_id', 'name', 'score', 'tags'])
    expect(columns.find((c) => c.name === '_id')!.dataType).toBe('mixed')
    expect(columns.find((c) => c.name === 'name')!.dataType).toBe('string')
    expect(columns.find((c) => c.name === 'score')!.dataType).toBe('double')
    expect(columns.find((c) => c.name === 'tags')!.dataType).toBe('array')
    // A missing field stays absent from the row: the grid tells it apart from null.
    expect('tags' in rows[0]!).toBe(false)
    expect(rows[2]!['name']).toBeNull()
  })
})

describe('inferFields', () => {
  it('flags fields missing from some documents as nullable and _id as the key', () => {
    const fields = inferFields([{ _id: 1, a: 1 }, { _id: 2, b: 'x' }], true)
    expect(fields).toEqual([
      { name: '_id', dataType: 'int', nullable: false, primaryKey: true },
      { name: 'a', dataType: 'int', nullable: true, primaryKey: false },
      { name: 'b', dataType: 'string', nullable: true, primaryKey: false },
    ])
  })

  it('still exposes _id for an empty collection', () => {
    expect(inferFields([], true)).toEqual([{ name: '_id', dataType: 'objectId', nullable: false, primaryKey: true }])
  })
})

describe('mongoPage', () => {
  it('pages inside the user limit and skip', () => {
    expect(mongoPage(undefined, undefined, 100, 0)).toEqual({ skip: 0, limit: 100 })
    expect(mongoPage(150, undefined, 100, 100)).toEqual({ skip: 100, limit: 50 })
    expect(mongoPage(undefined, 10, 20, 40)).toEqual({ skip: 50, limit: 20 })
  })

  it('returns null past the user limit, and treats limit(0) as no limit', () => {
    expect(mongoPage(50, undefined, 100, 100)).toBeNull()
    expect(mongoPage(0, undefined, 100, 0)).toEqual({ skip: 0, limit: 100 })
  })
})

describe('detectMongoGuardrail', () => {
  it('lets reads through', () => {
    expect(guard('db.users.find({})').level).toBe(0)
    expect(guard('db.users.aggregate([{ $group: { _id: "$a" } }])').level).toBe(0)
    expect(guard('db.getCollectionNames()').level).toBe(0)
    expect(guard('show dbs').level).toBe(0)
    expect(guard('db.runCommand({ dbStats: 1 })').level).toBe(0)
  })

  it('asks for confirmation on writes', () => {
    expect(guard('db.users.insertOne({ a: 1 })').level).toBe(1)
    expect(guard('db.users.updateOne({ _id: 1 }, { $set: { a: 2 } })').level).toBe(1)
    expect(guard('db.users.deleteMany({ a: 1 })').level).toBe(1)
    expect(guard('db.runCommand({ create: "x" })').level).toBe(1)
  })

  it('warns on filterless updateMany / deleteMany', () => {
    expect(guard('db.users.deleteMany({})')).toMatchObject({ level: 2, message: expect.stringContaining('deleteMany') })
    expect(guard('db.users.updateMany({}, { $set: { a: 1 } })').level).toBe(2)
    expect(guard('db.users.remove({})').level).toBe(2)
    expect(guard('db.users.aggregate([{ $match: {} }, { $merge: "other" }])').level).toBe(2)
  })

  it('flags destructive structure changes', () => {
    expect(guard('db.users.drop()').level).toBe(3)
    expect(guard('db.users.dropIndex("a_1")').level).toBe(3)
    expect(guard('db.users.aggregate([{ $out: "users_copy" }])').level).toBe(3)
    expect(guard('db.runCommand({ drop: "users" })').level).toBe(3)
  })

  it('sees wipes and account removals behind raw commands and bulkWrite', () => {
    expect(guard('db.runCommand({ delete: "users", deletes: [{ q: {}, limit: 0 }] })').level).toBe(2)
    expect(guard('db.runCommand({ delete: "users", deletes: [{ q: { a: 1 }, limit: 0 }] })').level).toBe(1)
    expect(guard('db.runCommand({ update: "users", updates: [{ q: {}, u: { $set: { a: 1 } }, multi: true }] })').level).toBe(2)
    expect(guard('db.runCommand({ dropUser: "bob" })').level).toBe(3)
    expect(guard('db.adminCommand({ shutdown: 1 })').level).toBe(4)
    expect(guard('db.users.bulkWrite([{ insertOne: { document: {} } }, { deleteMany: { filter: {} } }])').level).toBe(2)
  })

  it('asks before running server-side JavaScript', () => {
    expect(guard('db.users.find({ $where: "this.a > 1" })').level).toBe(1)
    expect(guard('db.users.aggregate([{ $match: { $expr: { $function: { body: "function() { return true }", args: [], lang: "js" } } } }])').level).toBe(1)
  })

  it('treats dropDatabase as critical, however it is spelled', () => {
    expect(guard('db.dropDatabase()').level).toBe(4)
    expect(guard('db.runCommand({ dropDatabase: 1 })').level).toBe(4)
  })
})

describe('toShellLiteral', () => {
  it('round-trips BSON values through the shell parser', () => {
    const doc = {
      _id: new ObjectId('65f1c0ffee0000000000abcd'),
      at: new Date('2024-01-01T00:00:00Z'),
      big: Long.fromString('9007199254740993'),
      dec: Decimal128.fromString('1.10'),
      u: new UUID('123e4567-e89b-12d3-a456-426614174000'),
      re: new BSONRegExp('a"b', 'i'),
      nested: { list: [1, 'two', null, true] },
      'odd "key"': 'value\nwith newline',
    }
    const cmd = parseMongoCommand(`db.c.insertOne(${toShellLiteral(doc)})`)
    const parsed = (cmd.kind === 'collection' ? cmd.call.args[0] : {}) as Record<string, unknown>
    expect((parsed['_id'] as ObjectId).equals(doc._id)).toBe(true)
    expect(parsed['at']).toEqual(doc.at)
    expect((parsed['big'] as Long).toString()).toBe('9007199254740993')
    expect((parsed['dec'] as Decimal128).toString()).toBe('1.10')
    expect((parsed['u'] as Binary).sub_type).toBe(Binary.SUBTYPE_UUID)
    expect((parsed['re'] as BSONRegExp).pattern).toBe('a"b')
    expect(parsed['nested']).toEqual(doc.nested)
    expect(parsed['odd "key"']).toBe('value\nwith newline')
  })
})
