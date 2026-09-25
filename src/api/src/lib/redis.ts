import type { QueryColumn } from '@dblumi/shared'
import type { PoolOptions } from './connection-manager.js'
import type { GuardrailResult } from './guardrail.js'
import { formatBytes } from './format.js'
import { quoteRedisArg } from './redis-command.js'

export const REDIS_DEFAULT_PORT = 6379
/** Keys sampled to build the schema browser (prefix groups). */
const SCHEMA_SAMPLE_KEYS = 5_000
/** Upper bound of keys collected by a SCAN/KEYS page, a sort or a count. */
const MAX_KEYS = 10_000
const COUNT_MAX_KEYS = 100_000
/** Strings above this size are not loaded into the grid (only their size). */
const MAX_INLINE_VALUE = 64 * 1024
/** A blocking command (BLPOP 0…) never holds a connection longer than this. */
const BLOCKING_TIMEOUT_MS = 30_000

/** The subset of @redis/client used here (its generic types are very heavy). */
export type RedisConn = {
  sendCommand<T = unknown>(args: string[]): Promise<T>
  duplicate(overrides?: Record<string, unknown>): RedisConn
  connect(): Promise<unknown>
  close(): Promise<void>
  destroy(): void
  on(event: 'error', listener: (err: unknown) => void): unknown
}

export type RedisResult = {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  total?: number
}

export type RedisSort = Array<{ column: string; direction: 'asc' | 'desc' }>

export function redisDatabaseIndex(database?: string | null): number {
  const n = Number((database ?? '').trim() || 0)
  return Number.isInteger(n) && n >= 0 && n < 100_000 ? n : 0
}

export async function createRedisClient(opts: PoolOptions, onError: (err: unknown) => void): Promise<RedisConn> {
  const { createClient } = await import('@redis/client')
  const client = createClient({
    socket: {
      host: (opts.host ?? 'localhost').trim(),
      port: opts.port ?? REDIS_DEFAULT_PORT,
      connectTimeout: 10_000,
      // Give up after a few attempts: a dead server must surface as an error,
      // not as requests queued forever.
      reconnectStrategy: (retries: number) => (retries > 5 ? new Error('Redis injoignable') : Math.min(retries * 200, 2_000)),
      ...(opts.ssl ? { tls: true as const } : {}),
    },
    ...(opts.username ? { username: opts.username } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    database: redisDatabaseIndex(opts.database),
    name: 'dblumi',
    // RESP2, like redis-cli: flat replies, and servers older than Redis 6 (no
    // HELLO 3) still connect. @redis/client 6 would negotiate RESP3 otherwise.
    RESP: 2,
  }) as unknown as RedisConn
  client.on('error', onError)
  await client.connect()
  return client
}

// ──────────────────────────────────────────────
// Command classes
// ──────────────────────────────────────────────

/** Would hijack or kill the shared connection (pub/sub, replication, protocol switch). */
const REJECTED = new Set([
  'SUBSCRIBE', 'PSUBSCRIBE', 'SSUBSCRIBE', 'UNSUBSCRIBE', 'PUNSUBSCRIBE', 'SUNSUBSCRIBE',
  'MONITOR', 'SYNC', 'PSYNC', 'HELLO', 'QUIT', 'RESET', 'AUTH',
])

/** Change the connection's state: they run on a dedicated connection, never on the shared one. */
const SESSION = new Set(['SELECT', 'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH', 'READONLY', 'READWRITE', 'ASKING'])

const BLOCKING = new Set([
  'BLPOP', 'BRPOP', 'BRPOPLPUSH', 'BLMOVE', 'BLMPOP', 'BZPOPMIN', 'BZPOPMAX', 'BZMPOP', 'WAIT', 'WAITAOF',
])

const READS = new Set([
  'GET', 'MGET', 'GETRANGE', 'SUBSTR', 'STRLEN', 'LCS', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'EXPIRETIME', 'PEXPIRETIME',
  'SCAN', 'HSCAN', 'SSCAN', 'ZSCAN', 'RANDOMKEY', 'DBSIZE', 'INFO', 'TIME', 'PING', 'ECHO', 'LASTSAVE',
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HSTRLEN', 'HRANDFIELD',
  'LRANGE', 'LLEN', 'LINDEX', 'LPOS',
  'SMEMBERS', 'SISMEMBER', 'SMISMEMBER', 'SCARD', 'SRANDMEMBER', 'SINTER', 'SUNION', 'SDIFF', 'SINTERCARD',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGE', 'ZREVRANGEBYSCORE', 'ZREVRANGEBYLEX', 'ZSCORE', 'ZMSCORE',
  'ZRANK', 'ZREVRANK', 'ZCARD', 'ZCOUNT', 'ZLEXCOUNT', 'ZRANDMEMBER', 'ZINTER', 'ZUNION', 'ZDIFF', 'ZINTERCARD',
  'XRANGE', 'XREVRANGE', 'XLEN', 'XINFO', 'XPENDING', 'XREAD',
  'GETBIT', 'BITCOUNT', 'BITPOS', 'BITFIELD_RO', 'PFCOUNT',
  'GEOPOS', 'GEODIST', 'GEOHASH', 'GEOSEARCH', 'GEORADIUS_RO', 'GEORADIUSBYMEMBER_RO',
  'SORT_RO', 'EVAL_RO', 'EVALSHA_RO', 'FCALL_RO', 'DUMP', 'TOUCH',
  'JSON.GET', 'JSON.MGET', 'JSON.TYPE', 'JSON.OBJKEYS', 'JSON.OBJLEN', 'JSON.ARRLEN', 'JSON.STRLEN',
  'FT.SEARCH', 'FT.AGGREGATE', 'FT.INFO', 'FT._LIST', 'FT.EXPLAIN', 'TS.GET', 'TS.MGET', 'TS.RANGE', 'TS.REVRANGE', 'TS.INFO',
])

/** Read-only subcommands of administrative commands. */
const READ_SUBCOMMANDS: Record<string, Set<string>> = {
  CONFIG: new Set(['GET']),
  CLIENT: new Set(['LIST', 'INFO', 'ID', 'GETNAME']),
  MEMORY: new Set(['USAGE', 'STATS', 'DOCTOR', 'MALLOC-STATS']),
  OBJECT: new Set(['ENCODING', 'IDLETIME', 'FREQ', 'REFCOUNT']),
  SLOWLOG: new Set(['GET', 'LEN']),
  COMMAND: new Set(['INFO', 'COUNT', 'DOCS', 'LIST', 'GETKEYS']),
  LATENCY: new Set(['LATEST', 'HISTORY', 'DOCTOR']),
  CLUSTER: new Set(['INFO', 'NODES', 'SLOTS', 'SHARDS', 'KEYSLOT', 'COUNTKEYSINSLOT']),
  ACL: new Set(['LIST', 'USERS', 'WHOAMI', 'CAT', 'GETUSER', 'LOG']),
  SCRIPT: new Set(['EXISTS']),
  FUNCTION: new Set(['LIST', 'STATS', 'DUMP']),
  XINFO: new Set(['STREAM', 'GROUPS', 'CONSUMERS']),
}

const upper = (s: string | undefined) => (s ?? '').toUpperCase()

export function redisCommandName(args: string[]): string {
  return upper(args[0])
}

function isBlocking(args: string[]): boolean {
  const name = redisCommandName(args)
  if (BLOCKING.has(name)) return true
  return (name === 'XREAD' || name === 'XREADGROUP') && args.some((a) => upper(a) === 'BLOCK')
}

function needsDedicated(args: string[]): boolean {
  const name = redisCommandName(args)
  if (SESSION.has(name) || isBlocking(args)) return true
  // CLIENT SETNAME / CLIENT REPLY… change the connection itself.
  return name === 'CLIENT' && !READ_SUBCOMMANDS['CLIENT']!.has(upper(args[1]))
}

function isRead(args: string[]): boolean {
  const name = redisCommandName(args)
  if (READS.has(name)) return true
  const sub = READ_SUBCOMMANDS[name]
  return !!sub && sub.has(upper(args[1]))
}

function guard(level: 1 | 2 | 3 | 4, message: string, details: string): GuardrailResult {
  return { level, message, details }
}

/** Same five levels as the SQL guardrail (see guardrail.ts). */
export function detectRedisGuardrail(args: string[]): GuardrailResult {
  const name = redisCommandName(args)
  const sub = upper(args[1])
  if (name === 'FLUSHALL' || name === 'FLUSHDB') {
    return guard(4, 'Opération critique irréversible', name === 'FLUSHALL'
      ? 'Cette commande supprime toutes les clés de toutes les bases du serveur.'
      : 'Cette commande supprime toutes les clés de la base.')
  }
  if (name === 'SHUTDOWN' || (name === 'DEBUG' && sub !== 'OBJECT')) {
    return guard(4, 'Arrêt ou plantage du serveur', 'Cette commande peut arrêter le serveur Redis.')
  }
  if (isRead(args)) return { level: 0 }
  if (name === 'KEYS') {
    return guard(2, 'KEYS bloque le serveur', 'KEYS parcourt toutes les clés en une fois et bloque Redis pendant ce temps. Préférez SCAN 0 MATCH motif.')
  }
  if (['CONFIG', 'SCRIPT', 'FUNCTION', 'CLUSTER', 'ACL', 'MODULE', 'REPLICAOF', 'SLAVEOF', 'SWAPDB', 'MIGRATE', 'FAILOVER'].includes(name)
    || (name === 'CLIENT' && ['KILL', 'PAUSE', 'NO-EVICT'].includes(sub))) {
    return guard(3, 'Commande d’administration', 'Cette commande modifie la configuration ou l’état du serveur Redis.')
  }
  if (name === 'EVAL' || name === 'EVALSHA' || name === 'FCALL') {
    return guard(1, 'Script côté serveur', 'Ce script Lua peut lire et modifier n’importe quelle clé.')
  }
  return guard(1, `${name} — modification de données`, 'Cette commande va modifier des données en base.')
}

/** Refuses what cannot run through the editor, with an explanation. */
export function assertRunnable(args: string[]): void {
  const name = redisCommandName(args)
  if (REJECTED.has(name)) {
    const why = name === 'AUTH' || name === 'HELLO'
      ? 'les identifiants se règlent dans la connexion'
      : name.endsWith('SUBSCRIBE') || name === 'MONITOR'
      ? 'le résultat est un flux continu, pas une réponse'
      : 'elle détournerait la connexion partagée'
    throw new Error(`${name} n'est pas supporté dans l'éditeur : ${why}.`)
  }
}

// ──────────────────────────────────────────────
// Replies → grid
// ──────────────────────────────────────────────

function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) return v.toString('utf8')
  if (Array.isArray(v)) return v.map(cell)
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), cell(x)]))
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cell(x)]))
  return String(v)
}

/**
 * `[k1, v1, k2, v2]` as RESP2 sends it. RESP3 shapes (a map, `[[k1, v1], …]`)
 * are flattened too, should a server or proxy answer in RESP3 anyway.
 */
export function flatPairs(reply: unknown): unknown[] {
  if (reply instanceof Map) return [...reply.entries()].flat()
  if (!Array.isArray(reply)) {
    return reply && typeof reply === 'object' && !Buffer.isBuffer(reply) ? Object.entries(reply).flat() : []
  }
  return reply.every((x) => Array.isArray(x) && x.length === 2) && reply.length > 0 ? reply.flat() : reply
}

function pairs(reply: unknown, a: string, b: string): Record<string, unknown>[] {
  const flat = flatPairs(reply)
  const out: Record<string, unknown>[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ [a]: cell(flat[i]), [b]: cell(flat[i + 1]) })
  return out
}

/** `# Server\r\nredis_version:7.2.4\r\n…` → one row per field. */
function parseInfo(text: string): Record<string, unknown>[] {
  let section = ''
  const rows: Record<string, unknown>[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) section = line.slice(1).trim()
    else if (line.includes(':')) {
      const sep = line.indexOf(':')
      rows.push({ section, key: line.slice(0, sep), value: line.slice(sep + 1) })
    }
  }
  return rows
}

function withScores(args: string[]): boolean {
  return args.some((a) => upper(a) === 'WITHSCORES')
}

/** Shapes a reply by command: hashes as field/value, sorted sets with scores, streams by entry. */
export function replyToRows(args: string[], reply: unknown): Record<string, unknown>[] {
  const name = redisCommandName(args)
  if (reply === null || reply === undefined) return [{ value: null }]
  if (name === 'INFO' && typeof reply === 'string') return parseInfo(reply)
  if (!Array.isArray(reply)) {
    if (reply instanceof Map || (typeof reply === 'object' && !Buffer.isBuffer(reply))) {
      return Object.entries(cell(reply) as Record<string, unknown>).map(([field, value]) => ({ field, value }))
    }
    return [{ value: cell(reply) }]
  }
  if (name === 'HGETALL' || (name === 'CONFIG' && upper(args[1]) === 'GET')
    || (name === 'HRANDFIELD' && args.some((a) => upper(a) === 'WITHVALUES'))) {
    return pairs(reply, 'field', 'value')
  }
  if (/^Z(REV)?RANGE(BYSCORE|BYLEX)?$|^ZRANDMEMBER$|^ZINTER$|^ZUNION$|^ZDIFF$/.test(name) && withScores(args)) {
    return pairs(reply, 'member', 'score')
  }
  if (name === 'ZPOPMIN' || name === 'ZPOPMAX') return pairs(reply, 'member', 'score')
  if (name === 'HSCAN' || name === 'SSCAN' || name === 'ZSCAN') {
    const items = Array.isArray(reply[1]) ? reply[1] : []
    if (name === 'SSCAN') return items.map((m) => ({ member: cell(m) }))
    return pairs(items, name === 'HSCAN' ? 'field' : 'member', name === 'HSCAN' ? 'value' : 'score')
  }
  if (name === 'XRANGE' || name === 'XREVRANGE') {
    return reply.map((entry) => {
      const [id, fields] = Array.isArray(entry) ? entry : [entry, []]
      const row: Record<string, unknown> = { id: cell(id) }
      const list = Array.isArray(fields) ? fields : []
      for (let i = 0; i + 1 < list.length; i += 2) {
        Object.defineProperty(row, String(cell(list[i])), { value: cell(list[i + 1]), enumerable: true, writable: true, configurable: true })
      }
      return row
    })
  }
  return reply.map((v, i) => ({ index: i, value: cell(v) }))
}

function columnsOf(rows: Record<string, unknown>[]): QueryColumn[] {
  const names: string[] = []
  const types = new Map<string, string>()
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (!types.has(k)) names.push(k)
      const t = v === null ? null : typeof v === 'number' ? 'int' : typeof v === 'object' ? 'array' : 'string'
      if (t && !types.get(k)) types.set(k, t)
    }
  }
  return names.map((name) => ({ name, dataType: types.get(name) ?? 'string' }))
}

function sortRows(rows: Record<string, unknown>[], sort: RedisSort): Record<string, unknown>[] {
  if (!sort.length) return rows
  return [...rows].sort((a, b) => {
    for (const { column, direction } of sort) {
      const x = a[column]
      const y = b[column]
      if (x === y) continue
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

// ──────────────────────────────────────────────
// Key browsing (SCAN / KEYS)
// ──────────────────────────────────────────────

type ScanOptions = { cursor: string; match?: string; count?: number; type?: string }

function parseScan(args: string[]): ScanOptions {
  const opts: ScanOptions = { cursor: args[1] ?? '0' }
  for (let i = 2; i + 1 < args.length; i += 2) {
    const key = upper(args[i])
    if (key === 'MATCH') opts.match = args[i + 1]!
    else if (key === 'COUNT') opts.count = Number(args[i + 1])
    else if (key === 'TYPE') opts.type = args[i + 1]!
  }
  return opts
}

/**
 * Walks the SCAN cursor until `want` keys are collected or the keyspace is
 * exhausted. In the editor, `SCAN 0 MATCH user:*` therefore fills a whole page
 * instead of returning whatever one iteration happened to find.
 */
async function scanKeys(client: RedisConn, opts: ScanOptions, want: number): Promise<{ keys: string[]; complete: boolean }> {
  const keys = new Set<string>()
  let cursor = opts.cursor
  let iterations = 0
  do {
    const args = ['SCAN', cursor]
    if (opts.match) args.push('MATCH', opts.match)
    args.push('COUNT', String(opts.count && opts.count > 0 ? opts.count : 1000))
    if (opts.type) args.push('TYPE', opts.type)
    const [next, batch] = await client.sendCommand<[string, string[]]>(args)
    cursor = String(next)
    for (const k of batch) keys.add(String(k))
    iterations++
  } while (cursor !== '0' && keys.size < want && iterations < 10_000)
  return { keys: [...keys], complete: cursor === '0' }
}

const SIZE_COMMAND: Record<string, string> = { hash: 'HLEN', list: 'LLEN', set: 'SCARD', zset: 'ZCARD', stream: 'XLEN' }

/** One grid row per key: type, TTL, size, and the value itself for (reasonably sized) strings. */
async function describeKeys(client: RedisConn, keys: string[]): Promise<Record<string, unknown>[]> {
  // Concurrent commands are pipelined by the client on one round trip.
  return Promise.all(keys.map(async (key) => {
    const [type, ttl] = await Promise.all([
      client.sendCommand<string>(['TYPE', key]),
      client.sendCommand<number>(['TTL', key]),
    ])
    let size: number | null = null
    let value: string | null = null
    if (type === 'string') {
      size = await client.sendCommand<number>(['STRLEN', key])
      if (size <= MAX_INLINE_VALUE) value = (await client.sendCommand<string | null>(['GET', key])) ?? null
    } else if (SIZE_COMMAND[type]) {
      size = await client.sendCommand<number>([SIZE_COMMAND[type]!, key])
    }
    return { key, type, ttl: Number(ttl), size, value }
  }))
}

const KEY_COLUMNS: QueryColumn[] = [
  { name: 'key', dataType: 'string' },
  { name: 'type', dataType: 'string' },
  { name: 'ttl', dataType: 'int' },
  { name: 'size', dataType: 'int' },
  { name: 'value', dataType: 'string' },
]

async function browseKeys(client: RedisConn, args: string[], limit: number | null, offset: number, sort: RedisSort): Promise<Omit<RedisResult, 'durationMs'>> {
  const name = redisCommandName(args)
  const pageEnd = limit === null ? MAX_KEYS : offset + limit
  let keys: string[]
  let total: number | undefined
  if (name === 'KEYS') {
    keys = (await client.sendCommand<string[]>(args)).map(String)
    total = keys.length
  } else {
    const opts = parseScan(args)
    const everything = (!opts.match || opts.match === '*') && !opts.type && opts.cursor === '0'
    // Sorting needs every key (bounded), a page only needs the keys up to its end.
    const scanned = await scanKeys(client, opts, sort.length ? MAX_KEYS : pageEnd)
    keys = scanned.keys
    if (everything) total = await client.sendCommand<number>(['DBSIZE'])
    else if (scanned.complete) total = keys.length
  }
  let rows: Record<string, unknown>[]
  if (sort.length) {
    const all = sortRows(await describeKeys(client, keys.slice(0, MAX_KEYS)), sort)
    rows = all.slice(offset, pageEnd)
  } else {
    rows = await describeKeys(client, keys.slice(offset, pageEnd))
  }
  return { columns: KEY_COLUMNS, rows, rowCount: rows.length, ...(total !== undefined ? { total } : {}) }
}

// ──────────────────────────────────────────────
// Execution
// ──────────────────────────────────────────────

/** Runs `fn` on a connection of its own, closed afterwards (session and blocking commands). */
async function withDedicated<T>(client: RedisConn, fn: (conn: RedisConn) => Promise<T>, timeoutMs?: number): Promise<T> {
  const conn = client.duplicate()
  conn.on('error', () => { /* surfaced by the command itself */ })
  await conn.connect()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (!timeoutMs) return await fn(conn)
    return await Promise.race([
      fn(conn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Commande bloquante interrompue après ${timeoutMs / 1000} s.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    conn.destroy()
  }
}

async function runOn(conn: RedisConn, args: string[], limit: number | null, offset: number, sort: RedisSort): Promise<Omit<RedisResult, 'durationMs'>> {
  const name = redisCommandName(args)
  if (name === 'SCAN' || name === 'KEYS') return browseKeys(conn, args, limit, offset, sort)
  const reply = await conn.sendCommand(args)
  const all = sortRows(replyToRows(args, reply), sort)
  const rows = limit === null ? all.slice(offset) : all.slice(offset, offset + limit)
  const count = typeof reply === 'number' && !isRead(args) ? reply : rows.length
  return { columns: columnsOf(all), rows, rowCount: count, total: all.length }
}

export async function executeRedis(
  client: RedisConn,
  args: string[],
  limit: number | null,
  offset = 0,
  sort: RedisSort = [],
): Promise<RedisResult> {
  assertRunnable(args)
  const start = Date.now()
  const result = needsDedicated(args)
    ? await withDedicated(client, (conn) => runOn(conn, args, limit, offset, sort), isBlocking(args) ? BLOCKING_TIMEOUT_MS : undefined)
    : await runOn(client, args, limit, offset, sort)
  return { ...result, durationMs: Date.now() - start }
}

/** A batch on one dedicated connection: `MULTI … EXEC` and `SELECT n` behave as in redis-cli. */
export async function runRedisBatch(
  client: RedisConn,
  commands: string[][],
  limit: number,
  hooks: { onStart: (index: number) => Promise<void>; onResult: (index: number, result: RedisResult) => Promise<void> },
): Promise<void> {
  commands.forEach(assertRunnable)
  await withDedicated(client, async (conn) => {
    for (const [i, args] of commands.entries()) {
      await hooks.onStart(i)
      const start = Date.now()
      const result = await runOn(conn, args, limit, 0, [])
      await hooks.onResult(i, { ...result, durationMs: Date.now() - start })
    }
  }, commands.some(isBlocking) ? BLOCKING_TIMEOUT_MS : undefined)
}

// ──────────────────────────────────────────────
// Introspection
// ──────────────────────────────────────────────

/** Prefix group of a key: `user:42:profile` → `user:*`. */
export function keyGroup(key: string): string {
  const sep = key.indexOf(':')
  return sep > 0 ? `${key.slice(0, sep)}:*` : '*'
}

/**
 * Redis has no tables: the schema browser shows `*` (every key) and one
 * pseudo-table per key prefix found in a sample, each with the same columns.
 */
export async function getRedisSchema(client: RedisConn) {
  const [{ keys, complete }, dbsize] = await Promise.all([
    scanKeys(client, { cursor: '0', count: 1000 }, SCHEMA_SAMPLE_KEYS),
    client.sendCommand<number>(['DBSIZE']),
  ])
  const groups = new Map<string, number>()
  for (const key of keys) {
    const g = keyGroup(key)
    if (g !== '*') groups.set(g, (groups.get(g) ?? 0) + 1)
  }
  const columns = [
    { name: 'key', dataType: 'string', nullable: false, primaryKey: true },
    { name: 'type', dataType: 'string', nullable: false, primaryKey: false },
    { name: 'ttl', dataType: 'int', nullable: false, primaryKey: false },
    { name: 'size', dataType: 'int', nullable: true, primaryKey: false },
    { name: 'value', dataType: 'string', nullable: true, primaryKey: false },
  ]
  const table = (name: string, comment: string) => ({ name, type: 'table' as const, comment, columns, indexes: [], foreignKeys: [] })
  const sampled = complete ? '' : ' (échantillon)'
  return {
    tables: [
      table('*', `${dbsize} clés`),
      ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, n]) => table(g, `${n} clés${sampled}`)),
    ],
    functions: [],
  }
}

/** Database indexes: the non-empty ones reported by INFO keyspace, plus the current one. */
export async function listRedisDatabases(client: RedisConn, current: number): Promise<string[]> {
  const info = await client.sendCommand<string>(['INFO', 'keyspace'])
  const found = new Set<number>([current])
  for (const m of info.matchAll(/^db(\d+):/gm)) found.add(Number(m[1]))
  return [...found].sort((a, b) => a - b).map(String)
}

function infoField(info: string, field: string): string | null {
  return info.match(new RegExp(`^${field}:(.*)$`, 'm'))?.[1]?.trim() ?? null
}

export async function getRedisStats(client: RedisConn) {
  const [server, memory] = await Promise.all([
    client.sendCommand<string>(['INFO', 'server']),
    client.sendCommand<string>(['INFO', 'memory']),
  ])
  const version = infoField(server, 'redis_version') ?? infoField(server, 'valkey_version')
  const used = Number(infoField(memory, 'used_memory') ?? 0) || null
  return {
    version: version ? `Redis ${version}` : null,
    encoding: null,
    timezone: null,
    sizeBytes: used,
    sizePretty: used ? formatBytes(used) : null,
  }
}

export async function countRedisPattern(client: RedisConn, pattern: string): Promise<number> {
  if (pattern === '*') return client.sendCommand<number>(['DBSIZE'])
  const { keys } = await scanKeys(client, { cursor: '0', match: pattern, count: 1000 }, COUNT_MAX_KEYS)
  return keys.length
}

/** redis-cli script recreating the keys of a pattern (strings, hashes, lists, sets, sorted sets). */
export async function dumpRedisPattern(client: RedisConn, pattern: string, includeData: boolean): Promise<string> {
  const lines = [`# Keys: ${quoteRedisArg(pattern)}`]
  if (!includeData) return lines.join('\n')
  const { keys, complete } = await scanKeys(client, { cursor: '0', match: pattern, count: 1000 }, COUNT_MAX_KEYS)
  for (const key of keys) {
    const k = quoteRedisArg(key)
    const type = await client.sendCommand<string>(['TYPE', key])
    const q = (items: unknown[]) => items.map((x) => quoteRedisArg(String(x))).join(' ')
    if (type === 'string') {
      lines.push(`SET ${k} ${quoteRedisArg(String(await client.sendCommand<string>(['GET', key])))}`)
    } else if (type === 'hash') {
      lines.push(`DEL ${k}`, `HSET ${k} ${q(flatPairs(await client.sendCommand(['HGETALL', key])))}`)
    } else if (type === 'list') {
      lines.push(`DEL ${k}`, `RPUSH ${k} ${q(await client.sendCommand<string[]>(['LRANGE', key, '0', '-1']))}`)
    } else if (type === 'set') {
      lines.push(`DEL ${k}`, `SADD ${k} ${q(await client.sendCommand<string[]>(['SMEMBERS', key]))}`)
    } else if (type === 'zset') {
      const flat = flatPairs(await client.sendCommand(['ZRANGE', key, '0', '-1', 'WITHSCORES']))
      const scoreFirst: string[] = []
      for (let i = 0; i + 1 < flat.length; i += 2) scoreFirst.push(String(flat[i + 1]), String(flat[i]))
      lines.push(`DEL ${k}`, `ZADD ${k} ${q(scoreFirst)}`)
    } else {
      lines.push(`# ${k}: type ${type} not exported`)
      continue
    }
    const ttl = await client.sendCommand<number>(['TTL', key])
    if (ttl > 0) lines.push(`EXPIRE ${k} ${ttl}`)
  }
  if (!complete) lines.push(`# truncated at ${COUNT_MAX_KEYS} keys`)
  return lines.join('\n')
}
