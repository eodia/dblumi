import {
  Binary,
  BSONRegExp,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  MongoClient,
  ObjectId,
  Timestamp,
  type CollationOptions,
  type Collection,
  type Db,
  type Document,
  type MongoClientOptions,
} from 'mongodb'
import type { QueryColumn } from '@dblumi/shared'
import type { PoolOptions } from './connection-manager.js'
import type { GuardrailResult } from './guardrail.js'
import { parseMongoCommand, type MongoCall, type MongoCommand } from './mongo-shell.js'
import { formatBytes } from './format.js'
import { logger } from '../logger.js'

export const MONGO_DEFAULT_PORT = 27017
/** Database used when the connection pins none — same default as mongosh. */
export const MONGO_DEFAULT_DATABASE = 'test'
export const MONGO_PING_TIMEOUT_MS = 10_000
/** Server-side time budget of every read issued from the editor or the schema browser. */
const MONGO_MAX_TIME_MS = 60_000
/** Documents sampled per collection to infer its fields. */
const SCHEMA_SAMPLE_SIZE = 100
const SCHEMA_MAX_COLLECTIONS = 500
const DUMP_MAX_DOCS = 100_000

export type MongoSort = Array<{ column: string; direction: 'asc' | 'desc' }>

export type MongoExecutionResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
}

// ──────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────

const URI_RE = /^(mongodb(?:\+srv)?):\/\/(.*)$/is

export function isMongoUri(host: string | undefined | null): boolean {
  return !!host && /^mongodb(\+srv)?:\/\//i.test(host.trim())
}

/**
 * A connection's `host` may be a plain hostname or a full URI
 * (`mongodb+srv://cluster0.example.net/?authSource=admin`, needed for Atlas and
 * replica sets). Credentials embedded in such a URI are split out so that they
 * end up encrypted in `password_encrypted` instead of in clear in `host`.
 */
export function splitMongoHostCredentials(host: string): {
  host: string
  username?: string
  password?: string
} {
  const trimmed = host.trim()
  const m = trimmed.match(URI_RE)
  if (!m) return { host: trimmed }
  const [, scheme, rest = ''] = m
  // Hosts never contain '@': the credentials end at the LAST '@' before the query
  // string. Splitting at the first one (or stopping at a '/') left the end of a
  // password with an unescaped '@' or '/' in clear in the stored host.
  const queryAt = rest.indexOf('?')
  const at = (queryAt === -1 ? rest : rest.slice(0, queryAt)).lastIndexOf('@')
  if (at === -1) return { host: trimmed }
  const userinfo = rest.slice(0, at)
  const sep = userinfo.indexOf(':')
  const rawUser = sep === -1 ? userinfo : userinfo.slice(0, sep)
  const rawPass = sep === -1 ? undefined : userinfo.slice(sep + 1)
  const username = safeDecode(rawUser)
  const password = rawPass !== undefined ? safeDecode(rawPass) : undefined
  return {
    host: `${scheme}://${rest.slice(at + 1)}`,
    ...(username ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
  }
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export function buildMongoClientConfig(opts: PoolOptions): { uri: string; options: MongoClientOptions } {
  const host = (opts.host ?? '').trim()
  if (!host) throw new Error('Hôte MongoDB manquant.')
  const options: MongoClientOptions = {
    appName: 'dblumi',
    maxPoolSize: 5,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  }
  if (opts.ssl) options.tls = true
  if (opts.username) {
    options.auth = { username: opts.username, password: opts.password ?? '' }
  }

  if (isMongoUri(host)) {
    // Never trust credentials that slipped into the stored URI: the dedicated
    // (encrypted) fields are the only source of truth.
    const { host: uri } = splitMongoHostCredentials(host)
    return { uri, options }
  }

  // A single host without replicaSet: connect to it directly, like mongosh does.
  // Otherwise the driver follows the replica set topology, whose member names are
  // often not resolvable from where dblumi runs (containers, private networks).
  options.directConnection = true
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return { uri: `mongodb://${bracketed}:${opts.port ?? MONGO_DEFAULT_PORT}/`, options }
}

export function createMongoClient(opts: PoolOptions): MongoClient {
  const { uri, options } = buildMongoClientConfig(opts)
  // No explicit connect(): the driver connects on the first operation, so a
  // down server surfaces as a regular query error instead of breaking getPool().
  return new MongoClient(uri, options)
}

export function mongoDatabaseName(database?: string | null): string {
  return database?.trim() || MONGO_DEFAULT_DATABASE
}

/** Round-trip + authorization check on the target database. */
export async function pingMongo(client: MongoClient, database: string): Promise<void> {
  const db = client.db(database)
  await db.command({ ping: 1 }, { timeoutMS: MONGO_PING_TIMEOUT_MS })
  // `ping` needs no privilege at all: list one collection name so that a user
  // without any right on this database fails the test instead of the first query.
  const cursor = db.listCollections({}, { nameOnly: true, authorizedCollections: true, batchSize: 1 })
  try {
    await cursor.tryNext()
  } finally {
    await cursor.close()
  }
}

// ──────────────────────────────────────────────
// BSON → grid values
// ──────────────────────────────────────────────

function bsonType(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double'
  if (typeof v === 'bigint') return 'long'
  if (v instanceof Date) return 'date'
  if (Array.isArray(v)) return 'array'
  if (v instanceof RegExp) return 'regex'
  if (typeof v === 'object' && '_bsontype' in v) {
    switch ((v as { _bsontype: string })._bsontype) {
      case 'ObjectId': return 'objectId'
      case 'Long': return 'long'
      case 'Int32': return 'int'
      case 'Double': return 'double'
      case 'Decimal128': return 'decimal'
      case 'Binary': return (v as Binary).sub_type === Binary.SUBTYPE_UUID ? 'uuid' : 'binData'
      case 'Timestamp': return 'timestamp'
      case 'BSONRegExp': return 'regex'
      case 'MinKey': return 'minKey'
      case 'MaxKey': return 'maxKey'
      case 'Code': return 'javascript'
      case 'BSONSymbol': return 'symbol'
      default: return 'object'
    }
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return 'binData'
  return 'object'
}

const NUMERIC_RANK: Record<string, number> = { int: 1, long: 2, double: 3, decimal: 4 }

/** Column type across documents: numeric types widen, anything else conflicting is "mixed". */
function mergeTypes(types: Set<string>): string {
  types.delete('null')
  if (types.size === 0) return 'null'
  if (types.size === 1) return [...types][0]!
  if ([...types].every((t) => t in NUMERIC_RANK)) {
    return [...types].reduce((a, b) => (NUMERIC_RANK[a]! >= NUMERIC_RANK[b]! ? a : b))
  }
  return 'mixed'
}

function isPlainDocument(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  if ('_bsontype' in v || v instanceof Date || v instanceof RegExp || v instanceof Uint8Array) return false
  return true
}

/**
 * Converts a BSON value to something JSON can carry.
 *
 * Top-level cells get a readable scalar (`ObjectId` → hex, `Date` → ISO…): the
 * column type tells the grid how to write it back. Values nested in objects or
 * arrays have no column type, so they keep an Extended JSON shape
 * (`{"$oid": "…"}`) that `mongo-shell.ts` parses back to the same BSON type.
 */
export function toCellValue(v: unknown, nested = false): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v
    const s = Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'
    return nested ? { $numberDouble: s } : s
  }
  if (typeof v === 'bigint') return nested ? { $numberLong: v.toString() } : v.toString()
  if (typeof v !== 'object') return v
  if (v instanceof Date) {
    const iso = Number.isNaN(v.getTime()) ? null : v.toISOString()
    return nested ? { $date: iso } : iso
  }
  if (Array.isArray(v)) return v.map((x) => toCellValue(x, true))
  if (v instanceof RegExp) {
    return nested ? { $regularExpression: { pattern: v.source, options: v.flags } } : String(v)
  }
  if ('_bsontype' in v) {
    switch ((v as { _bsontype: string })._bsontype) {
      case 'ObjectId': {
        const hex = (v as ObjectId).toHexString()
        return nested ? { $oid: hex } : hex
      }
      case 'Long': {
        const l = v as Long
        const safe = l.lessThanOrEqual(Number.MAX_SAFE_INTEGER) && l.greaterThanOrEqual(Number.MIN_SAFE_INTEGER)
        if (safe) return l.toNumber()
        return nested ? { $numberLong: l.toString() } : l.toString()
      }
      case 'Int32':
      case 'Double':
        return (v as Int32 | Double).valueOf()
      case 'Decimal128': {
        const s = (v as Decimal128).toString()
        return nested ? { $numberDecimal: s } : s
      }
      case 'Binary': {
        const b = v as Binary
        if (b.sub_type === Binary.SUBTYPE_UUID) {
          const uuid = b.toUUID().toHexString(true)
          return nested ? { $uuid: uuid } : uuid
        }
        const base64 = b.toString('base64')
        return nested ? { $binary: { base64, subType: b.sub_type.toString(16).padStart(2, '0') } } : base64
      }
      case 'Timestamp': {
        const ts = v as Timestamp
        return nested ? { $timestamp: { t: ts.t, i: ts.i } } : `Timestamp(${ts.t}, ${ts.i})`
      }
      case 'BSONRegExp': {
        const r = v as BSONRegExp
        return nested ? { $regularExpression: { pattern: r.pattern, options: r.options } } : `/${r.pattern}/${r.options}`
      }
      case 'MinKey': return nested ? { $minKey: 1 } : 'MinKey'
      case 'MaxKey': return nested ? { $maxKey: 1 } : 'MaxKey'
      case 'Code': return nested ? { $code: (v as Code).code } : (v as Code).code
      default: return String(v)
    }
  }
  if (v instanceof Uint8Array) {
    const base64 = Buffer.from(v).toString('base64')
    return nested ? { $binary: { base64, subType: '00' } } : base64
  }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    Object.defineProperty(out, k, { value: toCellValue(x, true), enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** Documents → grid. Columns are the union of top-level fields, `_id` first. */
export function documentsToResult(docs: Document[]): { columns: QueryColumn[]; rows: Record<string, unknown>[] } {
  const order: string[] = []
  const types = new Map<string, Set<string>>()
  for (const doc of docs) {
    for (const [k, v] of Object.entries(doc)) {
      let set = types.get(k)
      if (!set) {
        set = new Set()
        types.set(k, set)
        order.push(k)
      }
      set.add(bsonType(v))
    }
  }
  const idIdx = order.indexOf('_id')
  if (idIdx > 0) order.unshift(...order.splice(idIdx, 1))

  const columns = order.map((name) => ({ name, dataType: mergeTypes(types.get(name)!) }))
  const rows = docs.map((doc) => {
    const row: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(doc)) {
      Object.defineProperty(row, k, { value: toCellValue(v), enumerable: true, writable: true, configurable: true })
    }
    return row
  })
  return { columns, rows }
}

/** Any command output (documents, scalars, write results) → grid. */
function toTabular(value: unknown): { columns: QueryColumn[]; rows: Record<string, unknown>[] } {
  if (value === undefined) return { columns: [], rows: [] }
  if (Array.isArray(value)) {
    return documentsToResult(value.every(isPlainDocument) ? value : value.map((v) => ({ value: v })))
  }
  if (isPlainDocument(value)) return documentsToResult([value])
  return documentsToResult([{ result: value }])
}

// ──────────────────────────────────────────────
// Execution
// ──────────────────────────────────────────────

type Output = { value: unknown; rowCount?: number }

class MongoCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MongoCommandError'
  }
}

function asDocument(v: unknown, what: string, fallback?: Document): Document {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback
    throw new MongoCommandError(`${what} attendu.`)
  }
  if (!isPlainDocument(v)) throw new MongoCommandError(`${what} doit être un objet { … }.`)
  return v
}

function asPipeline(args: unknown[]): Document[] {
  // mongosh accepts both aggregate([stages], options) and the legacy aggregate(stage, stage…)
  const stages = Array.isArray(args[0]) ? args[0] : args
  if (!stages.every(isPlainDocument)) throw new MongoCommandError('Le pipeline doit être un tableau d’étapes { $stage: … }.')
  return stages
}

function asCount(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new MongoCommandError(`${what} attend un entier.`)
  return v
}

function sortSpec(sort: MongoSort): Array<[string, 1 | -1]> {
  return sort.map((s) => [s.column, s.direction === 'desc' ? -1 : 1])
}

/**
 * Page window over a user query: `.limit()` and `.skip()` written by the user
 * are honoured, and the grid pages inside them.
 * Returns null when the requested page lies entirely beyond the user's limit.
 */
export function mongoPage(
  userLimit: number | undefined,
  userSkip: number | undefined,
  limit: number,
  offset: number,
): { skip: number; limit: number } | null {
  const skip = Math.max(0, userSkip ?? 0) + offset
  // limit(0) means "no limit" in MongoDB; a negative limit means "one batch of |n|".
  if (userLimit !== undefined && userLimit !== 0) {
    const remaining = Math.abs(userLimit) - offset
    if (remaining <= 0) return null
    return { skip, limit: Math.min(limit, remaining) }
  }
  return { skip, limit }
}

type CursorSpec = {
  sort?: Document
  limit?: number
  skip?: number
  projection?: Document
  hint?: Document | string
  collation?: Document
  maxTimeMS?: number
  comment?: string
  allowDiskUse?: boolean
  explain?: string | boolean
  count?: boolean
}

const FIND_CHAIN = new Set([
  'sort', 'limit', 'skip', 'projection', 'project', 'hint', 'collation', 'maxTimeMS', 'comment',
  'allowDiskUse', 'batchSize', 'toArray', 'pretty', 'explain', 'count', 'itcount', 'size', 'readPref',
  'noCursorTimeout',
])
const AGGREGATE_CHAIN = new Set([
  'sort', 'limit', 'skip', 'project', 'match', 'maxTimeMS', 'comment', 'allowDiskUse', 'batchSize',
  'toArray', 'pretty', 'explain', 'itcount',
])

function readChain(chain: MongoCall[], allowed: Set<string>, base: string): CursorSpec {
  const spec: CursorSpec = {}
  for (const { method, args } of chain) {
    if (!allowed.has(method)) throw new MongoCommandError(`Méthode .${method}() non supportée après ${base}().`)
    switch (method) {
      case 'sort': spec.sort = asDocument(args[0], 'sort()'); break
      case 'limit': spec.limit = asCount(args[0], 'limit()'); break
      case 'skip': spec.skip = asCount(args[0], 'skip()'); break
      case 'projection':
      case 'project': spec.projection = asDocument(args[0], `${method}()`); break
      case 'hint': spec.hint = typeof args[0] === 'string' ? args[0] : asDocument(args[0], 'hint()'); break
      case 'collation': spec.collation = asDocument(args[0], 'collation()'); break
      case 'maxTimeMS': spec.maxTimeMS = asCount(args[0], 'maxTimeMS()'); break
      case 'comment': spec.comment = String(args[0] ?? ''); break
      case 'allowDiskUse': spec.allowDiskUse = args[0] === undefined ? true : Boolean(args[0]); break
      case 'explain': spec.explain = typeof args[0] === 'string' ? args[0] : true; break
      case 'count':
      case 'itcount':
      case 'size': spec.count = true; break
      case 'match':
        // Only meaningful on aggregate(): handled as an appended $match stage.
        break
      default: break // toArray, pretty, batchSize, readPref, noCursorTimeout: no effect on the result
    }
  }
  return spec
}

/** `.match()/.sort()/.skip()/.limit()/.project()` chained on aggregate() → stages, in call order. */
function chainStages(chain: MongoCall[]): Document[] {
  const stages: Document[] = []
  for (const { method, args } of chain) {
    if (method === 'match') stages.push({ $match: asDocument(args[0], 'match()') })
    else if (method === 'sort') stages.push({ $sort: asDocument(args[0], 'sort()') })
    else if (method === 'skip') stages.push({ $skip: asCount(args[0], 'skip()') })
    else if (method === 'limit') stages.push({ $limit: asCount(args[0], 'limit()') })
    else if (method === 'project') stages.push({ $project: asDocument(args[0], 'project()') })
  }
  return stages
}

function isWriteStage(stage: Document | undefined): boolean {
  return !!stage && ('$out' in stage || '$merge' in stage)
}

type PageArgs = { limit: number; offset: number; sort?: MongoSort | undefined }

async function runFind(coll: Collection, args: unknown[], chain: MongoCall[], page: PageArgs): Promise<Output> {
  const filter = asDocument(args[0], 'Le filtre de find()', {})
  const projection = args[1] === undefined ? undefined : asDocument(args[1], 'La projection de find()')
  const options = asDocument(args[2], 'Les options de find()', {})
  const spec = readChain(chain, FIND_CHAIN, 'find')
  const maxTimeMS = spec.maxTimeMS ?? MONGO_MAX_TIME_MS

  if (spec.count) {
    const value = await coll.countDocuments(filter, {
      maxTimeMS,
      ...(spec.skip !== undefined ? { skip: spec.skip } : {}),
      ...(spec.limit ? { limit: Math.abs(spec.limit) } : {}),
    })
    return { value: { count: value } }
  }

  const effectiveProjection = spec.projection ?? projection
  const cursor = coll.find(filter, {
    ...options,
    maxTimeMS,
    ...(effectiveProjection ? { projection: effectiveProjection } : {}),
    ...(spec.hint !== undefined ? { hint: spec.hint } : {}),
    // The server validates the collation document (locale is required there).
    ...(spec.collation ? { collation: spec.collation as CollationOptions } : {}),
    ...(spec.comment !== undefined ? { comment: spec.comment } : {}),
    ...(spec.allowDiskUse !== undefined ? { allowDiskUse: spec.allowDiskUse } : {}),
  })
  try {
    // The grid sort replaces the user's .sort(), exactly like the SQL wrapper does.
    if (page.sort?.length) cursor.sort(sortSpec(page.sort))
    else if (spec.sort) cursor.sort(spec.sort)

    if (spec.explain !== undefined) {
      const verbosity = typeof spec.explain === 'string' ? spec.explain : 'queryPlanner'
      return { value: await cursor.explain(verbosity as 'queryPlanner') }
    }

    const window = mongoPage(spec.limit, spec.skip, page.limit, page.offset)
    if (!window) return { value: [] }
    cursor.skip(window.skip).limit(window.limit)
    return { value: await cursor.toArray() }
  } finally {
    await cursor.close()
  }
}

async function runAggregate(
  target: Collection | Db,
  args: unknown[],
  chain: MongoCall[],
  page: PageArgs,
): Promise<Output> {
  const pipeline = asPipeline(args)
  const options = Array.isArray(args[0]) ? asDocument(args[1], 'Les options de aggregate()', {}) : {}
  const spec = readChain(chain, AGGREGATE_CHAIN, 'aggregate')
  const stages = [...pipeline, ...chainStages(chain)]
  const opts = {
    ...options,
    maxTimeMS: spec.maxTimeMS ?? (options['maxTimeMS'] as number | undefined) ?? MONGO_MAX_TIME_MS,
    ...(spec.allowDiskUse !== undefined ? { allowDiskUse: spec.allowDiskUse } : {}),
    ...(spec.comment !== undefined ? { comment: spec.comment } : {}),
  }

  if (spec.explain !== undefined) {
    const verbosity = typeof spec.explain === 'string' ? spec.explain : 'queryPlanner'
    return { value: await target.aggregate(stages, opts).explain(verbosity as 'queryPlanner') }
  }
  // $out / $merge must stay the last stage: run the pipeline untouched.
  if (isWriteStage(stages[stages.length - 1])) {
    await target.aggregate(stages, opts).toArray()
    return { value: { acknowledged: true }, rowCount: 0 }
  }
  if (spec.count) stages.push({ $count: 'count' })
  if (page.sort?.length) stages.push({ $sort: Object.fromEntries(sortSpec(page.sort)) })
  if (page.offset > 0) stages.push({ $skip: page.offset })
  stages.push({ $limit: page.limit })
  return { value: await target.aggregate(stages, opts).toArray() }
}

function writeOutput(res: Record<string, unknown>): Output {
  const count =
    (res['insertedCount'] as number | undefined) ??
    // insertOne() reports its insertedId only.
    ('insertedId' in res && res['acknowledged'] !== false ? 1 : undefined) ??
    ((res['modifiedCount'] as number | undefined) !== undefined || (res['upsertedCount'] as number | undefined) !== undefined
      ? ((res['modifiedCount'] as number) ?? 0) + ((res['upsertedCount'] as number) ?? 0)
      : undefined) ??
    (res['deletedCount'] as number | undefined) ??
    0
  // insertMany() returns insertedIds as {index: id}: an array reads better in a grid.
  const value = { ...res }
  if (value['insertedIds'] && typeof value['insertedIds'] === 'object' && !Array.isArray(value['insertedIds'])) {
    value['insertedIds'] = Object.values(value['insertedIds'] as Record<string, unknown>)
  }
  return { value, rowCount: count }
}

function hasUpdateOperators(update: Document): boolean {
  return Object.keys(update).some((k) => k.startsWith('$'))
}

async function runCollectionCall(db: Db, cmd: Extract<MongoCommand, { kind: 'collection' }>, page: PageArgs): Promise<Output> {
  const coll = db.collection(cmd.collection)
  const { method, args } = cmd.call
  const onlyReadChain = () => {
    if (cmd.chain.length > 0 && !cmd.chain.every((c) => ['toArray', 'pretty'].includes(c.method))) {
      throw new MongoCommandError(`Aucune méthode ne peut être chaînée après ${method}().`)
    }
  }
  const opts = (i: number) => asDocument(args[i], `Les options de ${method}()`, {})

  switch (method) {
    case 'find':
      return runFind(coll, args, cmd.chain, page)
    case 'aggregate':
      return runAggregate(coll, args, cmd.chain, page)
    default:
      onlyReadChain()
  }

  switch (method) {
    case 'findOne': {
      const projection = args[1] === undefined ? undefined : asDocument(args[1], 'La projection de findOne()')
      const doc = await coll.findOne(asDocument(args[0], 'Le filtre de findOne()', {}), {
        ...opts(2),
        maxTimeMS: MONGO_MAX_TIME_MS,
        ...(projection ? { projection } : {}),
      })
      return { value: doc ? [doc] : [] }
    }
    case 'countDocuments':
    case 'count':
      return { value: { count: await coll.countDocuments(asDocument(args[0], 'Le filtre', {}), { maxTimeMS: MONGO_MAX_TIME_MS, ...opts(1) }) } }
    case 'estimatedDocumentCount':
      return { value: { count: await coll.estimatedDocumentCount(opts(0)) } }
    case 'distinct': {
      if (typeof args[0] !== 'string') throw new MongoCommandError('distinct() attend un nom de champ.')
      const values = await coll.distinct(args[0], asDocument(args[1], 'Le filtre', {}), { maxTimeMS: MONGO_MAX_TIME_MS, ...opts(2) })
      return { value: values.map((value) => ({ value })) }
    }
    case 'getIndexes':
    case 'indexes':
    case 'getIndexSpecs':
      return { value: await coll.listIndexes().toArray() }
    case 'stats':
      return { value: await coll.aggregate([{ $collStats: { storageStats: {}, count: {} } }]).toArray() }

    case 'insertOne':
      return writeOutput(await coll.insertOne(asDocument(args[0], 'Le document'), opts(1)) as unknown as Record<string, unknown>)
    case 'insertMany': {
      if (!Array.isArray(args[0]) || !args[0].every(isPlainDocument)) throw new MongoCommandError('insertMany() attend un tableau de documents.')
      return writeOutput(await coll.insertMany(args[0], opts(1)) as unknown as Record<string, unknown>)
    }
    case 'insert': {
      const docs = Array.isArray(args[0]) ? args[0] : [args[0]]
      if (!docs.every(isPlainDocument)) throw new MongoCommandError('insert() attend un document ou un tableau de documents.')
      return writeOutput(await coll.insertMany(docs, opts(1)) as unknown as Record<string, unknown>)
    }
    case 'updateOne':
    case 'updateMany': {
      const filter = asDocument(args[0], 'Le filtre')
      const update = Array.isArray(args[1]) ? args[1] : asDocument(args[1], 'La mise à jour')
      const res = method === 'updateOne'
        ? await coll.updateOne(filter, update, opts(2))
        : await coll.updateMany(filter, update, opts(2))
      return writeOutput(res as unknown as Record<string, unknown>)
    }
    case 'update': {
      // Legacy mongosh helper: update(filter, update, { multi, upsert }).
      const filter = asDocument(args[0], 'Le filtre')
      const update = asDocument(args[1], 'La mise à jour')
      const { multi, ...rest } = opts(2)
      if (!hasUpdateOperators(update)) {
        return writeOutput(await coll.replaceOne(filter, update, rest) as unknown as Record<string, unknown>)
      }
      const res = multi ? await coll.updateMany(filter, update, rest) : await coll.updateOne(filter, update, rest)
      return writeOutput(res as unknown as Record<string, unknown>)
    }
    case 'replaceOne':
      return writeOutput(await coll.replaceOne(asDocument(args[0], 'Le filtre'), asDocument(args[1], 'Le document'), opts(2)) as unknown as Record<string, unknown>)
    case 'deleteOne':
      return writeOutput(await coll.deleteOne(asDocument(args[0], 'Le filtre'), opts(1)) as unknown as Record<string, unknown>)
    case 'deleteMany':
      return writeOutput(await coll.deleteMany(asDocument(args[0], 'Le filtre'), opts(1)) as unknown as Record<string, unknown>)
    case 'remove': {
      const filter = asDocument(args[0], 'Le filtre')
      const justOne = args[1] === true || (isPlainDocument(args[1]) && args[1]['justOne'] === true)
      const res = justOne ? await coll.deleteOne(filter) : await coll.deleteMany(filter)
      return writeOutput(res as unknown as Record<string, unknown>)
    }
    case 'findOneAndUpdate': {
      const update = Array.isArray(args[1]) ? args[1] : asDocument(args[1], 'La mise à jour')
      const doc = await coll.findOneAndUpdate(asDocument(args[0], 'Le filtre'), update, opts(2))
      return { value: doc ? [doc] : [], rowCount: doc ? 1 : 0 }
    }
    case 'findOneAndReplace': {
      const doc = await coll.findOneAndReplace(asDocument(args[0], 'Le filtre'), asDocument(args[1], 'Le document'), opts(2))
      return { value: doc ? [doc] : [], rowCount: doc ? 1 : 0 }
    }
    case 'findOneAndDelete': {
      const doc = await coll.findOneAndDelete(asDocument(args[0], 'Le filtre'), opts(1))
      return { value: doc ? [doc] : [], rowCount: doc ? 1 : 0 }
    }
    case 'bulkWrite': {
      if (!Array.isArray(args[0]) || !args[0].every(isPlainDocument)) throw new MongoCommandError('bulkWrite() attend un tableau d’opérations.')
      // The driver validates each operation's shape and reports a readable error.
      const res = await coll.bulkWrite(args[0] as unknown as Parameters<Collection['bulkWrite']>[0], opts(1))
      const { insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount } = res
      return { value: { insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount }, rowCount: insertedCount + modifiedCount + deletedCount + upsertedCount }
    }

    case 'createIndex': {
      const name = await coll.createIndex(asDocument(args[0], 'La clé d’index'), opts(1))
      return { value: { createdIndex: name }, rowCount: 0 }
    }
    case 'createIndexes': {
      // mongosh signature: createIndexes([keys…], options) — options apply to every index.
      if (!Array.isArray(args[0]) || !args[0].every(isPlainDocument)) throw new MongoCommandError('createIndexes() attend un tableau de clés.')
      const common = opts(1)
      const specs = args[0].map((key) => ({ ...common, key })) as unknown as Parameters<Collection['createIndexes']>[0]
      const names = await coll.createIndexes(specs)
      return { value: { createdIndexes: names }, rowCount: 0 }
    }
    case 'dropIndex': {
      const index = args[0]
      if (typeof index !== 'string' && !isPlainDocument(index)) throw new MongoCommandError('dropIndex() attend un nom ou une clé d’index.')
      if (typeof index === 'string') await coll.dropIndex(index)
      else await db.command({ dropIndexes: cmd.collection, index })
      return { value: { ok: 1 }, rowCount: 0 }
    }
    case 'dropIndexes':
      await coll.dropIndexes()
      return { value: { ok: 1 }, rowCount: 0 }
    case 'drop':
      return { value: { dropped: await coll.drop() }, rowCount: 0 }
    case 'renameCollection': {
      if (typeof args[0] !== 'string' || !args[0]) throw new MongoCommandError('renameCollection() attend le nouveau nom.')
      await coll.rename(args[0], { dropTarget: args[1] === true })
      return { value: { ok: 1 }, rowCount: 0 }
    }
    default:
      throw new MongoCommandError(`Méthode de collection non supportée : ${method}().`)
  }
}

/** Commands whose reply carries a cursor: show the documents, not the envelope. */
function unwrapCommandReply(reply: Document): unknown {
  const cursor = reply['cursor'] as Document | undefined
  if (cursor && Array.isArray(cursor['firstBatch'])) return cursor['firstBatch']
  return reply
}

async function runDbCall(client: MongoClient, db: Db, cmd: Extract<MongoCommand, { kind: 'db' }>, page: PageArgs): Promise<Output> {
  const { method, args } = cmd.call
  if (method === 'aggregate') return runAggregate(db, args, cmd.chain, page)
  if (cmd.chain.length > 0 && !cmd.chain.every((c) => ['toArray', 'pretty'].includes(c.method))) {
    throw new MongoCommandError(`Aucune méthode ne peut être chaînée après db.${method}().`)
  }
  switch (method) {
    case 'getCollectionNames': {
      const infos = await db.listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray()
      return { value: infos.map((i) => i.name).sort().map((name) => ({ name })) }
    }
    case 'getCollectionInfos':
    case 'listCollections':
      return { value: await db.listCollections(asDocument(args[0], 'Le filtre', {}), asDocument(args[1], 'Les options', {})).toArray() }
    case 'createCollection': {
      if (typeof args[0] !== 'string' || !args[0]) throw new MongoCommandError('createCollection() attend un nom.')
      await db.createCollection(args[0], asDocument(args[1], 'Les options', {}))
      return { value: { ok: 1 }, rowCount: 0 }
    }
    case 'createView': {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'string') throw new MongoCommandError('createView() attend (nom, source, pipeline).')
      await db.createCollection(args[0], { viewOn: args[1], pipeline: asPipeline([args[2] ?? []]) })
      return { value: { ok: 1 }, rowCount: 0 }
    }
    case 'dropDatabase':
      return { value: { dropped: await db.dropDatabase() }, rowCount: 0 }
    case 'runCommand':
      return { value: unwrapCommandReply(await db.command(asDocument(args[0], 'La commande'))) }
    case 'adminCommand':
      return { value: unwrapCommandReply(await client.db('admin').command(asDocument(args[0], 'La commande'))) }
    case 'stats':
      return { value: await db.stats() }
    case 'serverStatus':
      return { value: await db.admin().serverStatus() }
    case 'version':
      return { value: { version: (await db.admin().buildInfo())['version'] } }
    case 'getName':
      return { value: { name: db.databaseName } }
    case 'getUsers':
      return { value: ((await db.command({ usersInfo: 1 }))['users'] as unknown[]) ?? [] }
    case 'getRoles':
      return { value: ((await db.command({ rolesInfo: 1 }))['roles'] as unknown[]) ?? [] }
    case 'currentOp':
      return { value: ((await client.db('admin').command({ currentOp: 1, ...asDocument(args[0], 'Le filtre', {}) }))['inprog'] as unknown[]) ?? [] }
    default:
      throw new MongoCommandError(`Méthode non supportée : db.${method}().`)
  }
}

export async function executeMongo(
  client: MongoClient,
  database: string,
  source: string | MongoCommand,
  limit: number,
  offset = 0,
  sort?: MongoSort,
): Promise<MongoExecutionResult> {
  const cmd = typeof source === 'string' ? parseMongoCommand(source) : source
  const start = Date.now()
  const page: PageArgs = { limit, offset, sort }
  let output: Output

  if (cmd.kind === 'show') {
    if (cmd.target === 'dbs') {
      const { databases } = await client.db('admin').admin().listDatabases({ authorizedDatabases: true })
      output = { value: databases.map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk ?? null, empty: d.empty ?? null })) }
    } else {
      const infos = await client.db(database).listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray()
      output = { value: infos.map((i) => i.name).sort().map((name) => ({ name })) }
    }
  } else {
    const db = client.db(cmd.database ?? database)
    output = cmd.kind === 'db'
      ? await runDbCall(client, db, cmd, page)
      : await runCollectionCall(db, cmd, page)
  }

  const { columns, rows } = toTabular(output.value)
  return {
    columns,
    rows,
    rowCount: output.rowCount ?? rows.length,
    durationMs: Date.now() - start,
  }
}

/**
 * Total number of results of a find()/aggregate() command (grid pagination),
 * or null when the command is not a paginated read.
 */
export async function countMongo(client: MongoClient, database: string, source: string | MongoCommand): Promise<number | null> {
  const cmd = typeof source === 'string' ? parseMongoCommand(source) : source
  if (cmd.kind !== 'collection') return null
  const coll = client.db(cmd.database ?? database).collection(cmd.collection)
  const { method, args } = cmd.call

  if (method === 'find') {
    const filter = asDocument(args[0], 'Le filtre', {})
    const spec = readChain(cmd.chain, FIND_CHAIN, 'find')
    if (spec.count || spec.explain !== undefined) return null
    if (Object.keys(filter).length === 0 && spec.skip === undefined && !spec.limit) {
      return coll.estimatedDocumentCount({ maxTimeMS: MONGO_MAX_TIME_MS })
    }
    return coll.countDocuments(filter, {
      maxTimeMS: MONGO_MAX_TIME_MS,
      ...(spec.skip !== undefined ? { skip: spec.skip } : {}),
      ...(spec.limit ? { limit: Math.abs(spec.limit) } : {}),
    })
  }
  if (method === 'aggregate') {
    const stages = [...asPipeline(args), ...chainStages(cmd.chain)]
    if (isWriteStage(stages[stages.length - 1])) return null
    const spec = readChain(cmd.chain, AGGREGATE_CHAIN, 'aggregate')
    if (spec.explain !== undefined || spec.count) return null
    const [row] = await coll.aggregate([...stages, { $count: 'n' }], { maxTimeMS: MONGO_MAX_TIME_MS }).toArray()
    return Number(row?.['n'] ?? 0)
  }
  return null
}

// ──────────────────────────────────────────────
// Guardrail
// ──────────────────────────────────────────────

const READ_COLLECTION_METHODS = new Set([
  'find', 'findOne', 'count', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'getIndexes',
  'indexes', 'getIndexSpecs', 'stats',
])
const READ_DB_METHODS = new Set([
  'getCollectionNames', 'getCollectionInfos', 'listCollections', 'stats', 'serverStatus', 'version',
  'getName', 'getUsers', 'getRoles', 'currentOp',
])
/** runCommand() documents whose first key names a read-only command. */
const READ_COMMANDS = new Set([
  'ping', 'hello', 'isMaster', 'ismaster', 'buildInfo', 'buildinfo', 'serverStatus', 'dbStats', 'dbstats',
  'collStats', 'listCollections', 'listIndexes', 'listDatabases', 'find', 'count', 'distinct', 'explain',
  'connectionStatus', 'hostInfo', 'getParameter', 'usersInfo', 'rolesInfo', 'currentOp', 'top',
  'validate', 'getLog', 'replSetGetStatus', 'dataSize',
])

function guard(level: 1 | 2 | 3 | 4, message: string, details: string): GuardrailResult {
  return { level, message, details }
}

function isEmptyFilter(v: unknown): boolean {
  return v === undefined || v === null || (isPlainDocument(v) && Object.keys(v).length === 0)
}

/** Operators whose value is JavaScript executed by mongod. */
const SERVER_JS_OPERATORS = new Set(['$where', '$function', '$accumulator'])

function containsServerJs(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (Array.isArray(value)) return value.some((v) => containsServerJs(v, depth + 1))
  if (!isPlainDocument(value)) return false
  return Object.entries(value).some(([k, v]) => SERVER_JS_OPERATORS.has(k) || containsServerJs(v, depth + 1))
}

/** Same five levels as the SQL guardrail (see guardrail.ts). */
export function detectMongoGuardrail(cmd: MongoCommand): GuardrailResult {
  const base = commandGuardrail(cmd)
  // JavaScript runs inside mongod with the user's rights: never silently —
  // and never replayed behind the user's back by the grid's row count.
  if (base.level === 0 && cmd.kind !== 'show' && containsServerJs([cmd.call.args, ...cmd.chain.map((c) => c.args)])) {
    return guard(1, 'Code JavaScript côté serveur', 'Cette commande exécute du JavaScript ($where, $function ou $accumulator) sur le serveur MongoDB.')
  }
  return base
}

function commandGuardrail(cmd: MongoCommand): GuardrailResult {
  if (cmd.kind === 'show') return { level: 0 }
  const { method, args } = cmd.call

  if (cmd.kind === 'db') {
    if (method === 'dropDatabase') {
      return guard(4, 'Opération critique irréversible', 'Cette opération supprime définitivement la base de données et toutes ses collections.')
    }
    if (READ_DB_METHODS.has(method)) return { level: 0 }
    if (method === 'aggregate') return aggregateGuard(args)
    if (method === 'runCommand' || method === 'adminCommand') {
      const doc: Document = isPlainDocument(args[0]) ? args[0] : {}
      const first = Object.keys(doc)[0]
      if (first === 'dropDatabase') return guard(4, 'Opération critique irréversible', 'Cette commande supprime définitivement la base de données.')
      if (first === 'shutdown') return guard(4, 'Arrêt du serveur', 'Cette commande arrête le serveur MongoDB.')
      if (first === 'drop' || first === 'dropIndexes' || first === 'renameCollection') {
        return guard(3, 'Opération structurelle dangereuse', 'Cette commande supprime ou renomme des objets de la base.')
      }
      if (first && ['dropUser', 'dropRole', 'dropAllUsersFromDatabase', 'dropAllRolesFromDatabase'].includes(first)) {
        return guard(3, 'Suppression de comptes', 'Cette commande supprime des utilisateurs ou des rôles de la base.')
      }
      // The raw write commands behind deleteMany({}) / updateMany({}, …).
      const statementsOf = (key: string) => (Array.isArray(doc[key]) ? (doc[key] as unknown[]).filter(isPlainDocument) : [])
      if (first === 'delete' && statementsOf('deletes').some((d) => isEmptyFilter(d['q']) && d['limit'] !== 1)) {
        return guard(2, 'delete sans filtre', 'Cette commande va supprimer tous les documents de la collection.')
      }
      if (first === 'update' && statementsOf('updates').some((u) => isEmptyFilter(u['q']) && u['multi'] === true)) {
        return guard(2, 'update multi sans filtre', 'Cette commande va modifier tous les documents de la collection.')
      }
      if (first === 'aggregate' && isPlainDocument(args[0])) {
        return aggregateGuard([(args[0] as Record<string, unknown>)['pipeline'] ?? []])
      }
      if (first && READ_COMMANDS.has(first)) return { level: 0 }
      return guard(1, 'Commande non reconnue', "L'effet de cette commande n'a pas pu être déterminé.")
    }
    return guard(1, `db.${method}() — modification`, 'Cette commande modifie la base de données.')
  }

  if (READ_COLLECTION_METHODS.has(method)) return { level: 0 }
  if (method === 'aggregate') return aggregateGuard(args)

  switch (method) {
    case 'drop':
      return guard(3, 'Suppression de collection', `La collection ${cmd.collection} et tous ses documents seront supprimés définitivement.`)
    case 'dropIndex':
    case 'dropIndexes':
    case 'renameCollection':
      return guard(3, 'Opération structurelle dangereuse', 'Cette opération modifie ou supprime des objets de la collection.')
    case 'updateMany':
    case 'deleteMany':
    case 'remove':
      if (isEmptyFilter(args[0])) {
        const op = method === 'updateMany' ? 'updateMany' : 'deleteMany'
        return guard(2, `${op} sans filtre`, method === 'updateMany'
          ? 'Cette commande va modifier tous les documents de la collection.'
          : 'Cette commande va supprimer tous les documents de la collection.')
      }
      break
    case 'update': {
      const multi = isPlainDocument(args[2]) && args[2]['multi'] === true
      if (multi && isEmptyFilter(args[0])) {
        return guard(2, 'update multi sans filtre', 'Cette commande va modifier tous les documents de la collection.')
      }
      break
    }
    case 'bulkWrite': {
      const ops = Array.isArray(args[0]) ? args[0].filter(isPlainDocument) : []
      const wipes = ops.some((op) => ['deleteMany', 'updateMany'].some((k) => isPlainDocument(op[k]) && isEmptyFilter((op[k] as Document)['filter'])))
      if (wipes) {
        return guard(2, 'bulkWrite sans filtre', 'Une opération du lot modifie ou supprime tous les documents de la collection.')
      }
      break
    }
  }
  return guard(1, `${method} — modification de données`, 'Cette commande va modifier des données en base.')
}

function aggregateGuard(args: unknown[]): GuardrailResult {
  const stages = Array.isArray(args[0]) ? args[0] : args
  const last = stages[stages.length - 1]
  if (isPlainDocument(last) && '$out' in last) {
    return guard(3, 'Agrégation avec $out', 'La collection cible de $out sera entièrement remplacée par le résultat du pipeline.')
  }
  if (isPlainDocument(last) && '$merge' in last) {
    return guard(2, 'Agrégation avec $merge', 'Le résultat du pipeline sera fusionné dans une collection existante.')
  }
  return { level: 0 }
}

// ──────────────────────────────────────────────
// Introspection
// ──────────────────────────────────────────────

type SchemaColumn = { name: string; dataType: string; nullable: boolean; primaryKey: boolean }
type SchemaTable = {
  name: string
  type: 'table' | 'view'
  comment: string
  columns: SchemaColumn[]
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
  foreignKeys: never[]
}

/** Top-level fields of a document sample; a field absent from some documents is nullable. */
export function inferFields(docs: Document[], withId: boolean): SchemaColumn[] {
  const { columns } = documentsToResult(docs)
  const cols = columns.map((c) => ({
    name: c.name,
    dataType: c.dataType === 'null' ? 'mixed' : c.dataType,
    nullable: c.name !== '_id' && docs.some((d) => d[c.name] === null || d[c.name] === undefined),
    primaryKey: c.name === '_id',
  }))
  if (withId && !cols.some((c) => c.name === '_id')) {
    cols.unshift({ name: '_id', dataType: 'objectId', nullable: false, primaryKey: true })
  }
  return cols
}

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

/**
 * Schema browser view of a database: collections are tables whose columns are
 * inferred from a sample of documents (MongoDB has no declared schema).
 */
export async function getMongoSchema(client: MongoClient, database: string): Promise<{ tables: SchemaTable[]; functions: never[] }> {
  const db = client.db(database)
  const infos = (await db.listCollections({}, { authorizedCollections: true }).toArray())
    .filter((i) => !i.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (infos.length > SCHEMA_MAX_COLLECTIONS) {
    logger.warn({ database, total: infos.length, kept: SCHEMA_MAX_COLLECTIONS }, 'MongoDB collection list truncated')
  }

  const tables = await mapLimit(infos.slice(0, SCHEMA_MAX_COLLECTIONS), 8, async (info): Promise<SchemaTable> => {
    const isView = info.type === 'view'
    const coll = db.collection(info.name)
    const [docs, indexes] = await Promise.all([
      coll.find({}, { limit: SCHEMA_SAMPLE_SIZE, maxTimeMS: 5_000 }).toArray().catch(() => [] as Document[]),
      isView ? Promise.resolve([] as Document[]) : coll.listIndexes().toArray().catch(() => [] as Document[]),
    ])
    return {
      name: info.name,
      type: isView ? 'view' : 'table',
      comment: '',
      columns: inferFields(docs, !isView),
      indexes: indexes
        .filter((ix) => ix['name'] !== '_id_')
        .map((ix) => ({ name: String(ix['name']), columns: Object.keys(ix['key'] ?? {}), unique: ix['unique'] === true })),
      foreignKeys: [],
    }
  })
  return { tables, functions: [] }
}

export async function listMongoDatabases(client: MongoClient): Promise<string[]> {
  const { databases } = await client.db('admin').admin().listDatabases({ nameOnly: true, authorizedDatabases: true })
  return databases.map((d) => d.name).sort()
}

export async function getMongoStats(client: MongoClient, database: string) {
  const db = client.db(database)
  const [info, stats] = await Promise.all([
    db.admin().buildInfo().catch(() => null),
    db.stats().catch(() => null),
  ])
  // totalSize exists since MongoDB 4.4; older servers only report its two halves.
  const size = stats
    ? Number(stats['totalSize'] ?? Number(stats['storageSize'] ?? 0) + Number(stats['indexSize'] ?? 0))
    : 0
  const sizeBytes = size > 0 ? size : null
  return {
    version: info?.['version'] ? `MongoDB ${String(info['version'])}` : null,
    encoding: 'UTF-8',
    timezone: 'UTC',
    sizeBytes,
    sizePretty: sizeBytes ? formatBytes(sizeBytes) : null,
  }
}

export async function countMongoCollection(client: MongoClient, database: string, collection: string): Promise<number> {
  return client.db(database).collection(collection).estimatedDocumentCount({ maxTimeMS: MONGO_MAX_TIME_MS })
}

// ──────────────────────────────────────────────
// Dump (mongosh script)
// ──────────────────────────────────────────────

/** mongosh literal of a BSON value — the inverse of mongo-shell.ts. */
export function toShellLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
    return Object.is(v, -0) ? '-0' : String(v)
  }
  if (typeof v === 'bigint') return `NumberLong(${JSON.stringify(v.toString())})`
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'null' : `ISODate(${JSON.stringify(v.toISOString())})`
  if (v instanceof RegExp) return `RegExp(${JSON.stringify(v.source)}, ${JSON.stringify(v.flags)})`
  if (Array.isArray(v)) return `[${v.map(toShellLiteral).join(', ')}]`
  if (typeof v === 'object' && '_bsontype' in v) {
    switch ((v as { _bsontype: string })._bsontype) {
      case 'ObjectId': return `ObjectId(${JSON.stringify((v as ObjectId).toHexString())})`
      case 'Long': return `NumberLong(${JSON.stringify((v as Long).toString())})`
      case 'Int32': return `NumberInt(${(v as Int32).valueOf()})`
      case 'Double': return toShellLiteral((v as Double).valueOf())
      case 'Decimal128': return `NumberDecimal(${JSON.stringify((v as Decimal128).toString())})`
      case 'Binary': {
        const b = v as Binary
        return b.sub_type === Binary.SUBTYPE_UUID
          ? `UUID(${JSON.stringify(b.toUUID().toHexString(true))})`
          : `BinData(${b.sub_type}, ${JSON.stringify(b.toString('base64'))})`
      }
      case 'Timestamp': return `Timestamp({ t: ${(v as Timestamp).t}, i: ${(v as Timestamp).i} })`
      case 'BSONRegExp': return `RegExp(${JSON.stringify((v as BSONRegExp).pattern)}, ${JSON.stringify((v as BSONRegExp).options)})`
      case 'MinKey': return 'MinKey()'
      case 'MaxKey': return 'MaxKey()'
      case 'Code': return `Code(${JSON.stringify((v as Code).code)})`
      default: return JSON.stringify(String(v))
    }
  }
  if (v instanceof Uint8Array) return `BinData(0, ${JSON.stringify(Buffer.from(v).toString('base64'))})`
  const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${toShellLiteral(x)}`)
  return entries.length ? `{ ${entries.join(', ')} }` : '{}'
}

/** Recreates a collection (options, indexes and optionally its documents) as a mongosh script. */
export async function dumpMongoCollection(
  client: MongoClient,
  database: string,
  name: string,
  includeData: boolean,
  maxDocs = DUMP_MAX_DOCS,
): Promise<string> {
  const db = client.db(database)
  const [info] = await db.listCollections({ name }).toArray()
  if (!info) throw new Error(`Collection introuvable : ${name}`)
  const quoted = JSON.stringify(name)
  const ref = `db.getCollection(${quoted})`
  // The name is JSON-quoted even in the comment: a newline in it must not escape the comment.
  const parts = [`// Collection: ${quoted}`]

  const options = { ...((info as Document)['options'] as Document | undefined) }
  if (info.type === 'view') {
    parts.push(`db.createView(${quoted}, ${JSON.stringify(options['viewOn'] ?? '')}, ${toShellLiteral(options['pipeline'] ?? [])});`)
    return parts.join('\n')
  }
  parts.push(`db.createCollection(${quoted}${Object.keys(options).length ? `, ${toShellLiteral(options)}` : ''});`)

  const indexes = await db.collection(name).listIndexes().toArray()
  for (const ix of indexes) {
    if (ix['name'] === '_id_') continue
    const { key, v: _v, ns: _ns, ...rest } = ix
    parts.push(`${ref}.createIndex(${toShellLiteral(key)}, ${toShellLiteral(rest)});`)
  }

  if (includeData) {
    const cursor = db.collection(name).find({}, { limit: maxDocs + 1 })
    let batch: string[] = []
    let count = 0
    let truncated = false
    const flush = () => {
      if (batch.length) parts.push(`${ref}.insertMany([\n  ${batch.join(',\n  ')}\n]);`)
      batch = []
    }
    try {
      for await (const doc of cursor) {
        if (count === maxDocs) {
          truncated = true
          break
        }
        batch.push(toShellLiteral(doc))
        count++
        if (batch.length === 1000) flush()
      }
    } finally {
      await cursor.close()
    }
    flush()
    if (truncated) parts.push(`// data truncated at ${maxDocs} documents`)
  }
  return parts.join('\n')
}
