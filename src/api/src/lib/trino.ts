import { BasicAuth, Trino } from 'trino-client'
import type {
  ConnectionOptions,
  Query as TrinoQuery,
  QueryError as TrinoErrorPayload,
  QueryResult as TrinoChunk,
} from 'trino-client'
import type { QueryColumn } from '@dblumi/shared'

/**
 * Trino helper layer.
 *
 * This is the ONLY module allowed to import `trino-client` values at runtime.
 * Every other file imports the symbols exported here, plus `import type { Trino }`.
 *
 * Trino specifics that shape this file:
 * - SQL errors are NOT thrown: they arrive with HTTP 200 inside `chunk.error`.
 * - The terminal chunk is yielded once with `done:false` then repeated with
 *   `done:true` — the loop must stop on `done`, never re-handle the value.
 * - `/v1/statement` rejects a trailing `;`, even for non-SELECT statements.
 * - `trino-client@0.2.9` exposes no timeout at all (axios without `timeout`),
 *   so slow/blackholed hosts are handled here with an explicit deadline.
 */

export const TRINO_DEFAULT_PORT = 8080
export const TRINO_PING_TIMEOUT_MS = 10_000

/**
 * `client.cancel()` goes through axios without any timeout: without this bound a
 * mute coordinator would make the deadline path itself hang forever.
 */
const TRINO_CANCEL_TIMEOUT_MS = 2_000

/** Fallback identity — the coordinator rejects a request carrying no `X-Trino-User`. */
const TRINO_FALLBACK_USER = 'dblumi'

export type TrinoTarget = { catalog?: string; schema?: string }

export type TrinoClientOptions = {
  host?: string | undefined
  port?: number | undefined
  username?: string | undefined
  password?: string | undefined
  ssl?: boolean | undefined
  /** Trino target: "catalog" | "catalog/schema" | "catalog.schema" */
  database?: string | undefined
}

export type TrinoResult = {
  /** Column metadata, `dataType` holds the raw Trino type (varchar(10), bigint...). */
  columns: QueryColumn[]
  /** `columns` zipped with `data` — duplicate column names overwrite each other. */
  rows: Record<string, unknown>[]
  /** Raw positional rows, for single-cell reads such as `data[0]?.[0]`. */
  data: unknown[][]
  rowCount: number
  /** Rows affected by a DML statement, when the coordinator reports one. */
  updateCount: number | undefined
  /** True when `opts.maxRows` stopped the drain before the end of the result set. */
  truncated: boolean
  queryId: string | undefined
  state: string | undefined
}

/** A statement rejected by the coordinator (payload carried by a HTTP 200 chunk). */
export class TrinoQueryError extends Error {
  readonly errorName: string | undefined
  readonly errorCode: number | undefined
  readonly errorType: string | undefined

  constructor(payload?: TrinoErrorPayload | undefined) {
    super(payload?.message ?? 'Erreur Trino inconnue.')
    this.name = 'TrinoQueryError'
    this.errorName = payload?.errorName
    this.errorCode = payload?.errorCode
    this.errorType = payload?.errorType
  }
}

/** Internal marker — never leaves this module. */
class TrinoDeadlineExceeded extends Error {}

/**
 * Server URL per client instance, used to build readable connection errors.
 * `Trino` exposes no accessor on its own options.
 */
const serverByClient = new WeakMap<Trino, string>()

/**
 * Target the client was built with. `runTrino` falls back to it when a caller
 * passes no explicit target, so EVERY statement carries an explicit
 * `X-Trino-Catalog` / `X-Trino-Schema`. Without this the request would inherit
 * the client's instance headers, which `Client.request()` rewrites from every
 * `X-Trino-Set-Catalog` response header: a single `USE other.schema` would
 * durably re-bind the shared client for all users of that connection.
 */
const targetByClient = new WeakMap<Trino, TrinoTarget>()

// ──────────────────────────────────────────────
// Target parsing
// ──────────────────────────────────────────────

/**
 * Parses the `database` column into a Trino target.
 * Accepts "catalog", "catalog/schema" and "catalog.schema".
 *
 * Case follows the Trino rule: an unquoted identifier is folded to lower case,
 * a quoted one keeps its case. Without the folding, `HIVE/DEFAULT` would build
 * `SHOW SCHEMAS FROM "HIVE"` (catalog not found) and a `table_schema =
 * 'DEFAULT'` filter matching nothing — an empty schema browser, no error.
 */
export function parseTrinoTarget(database?: string | null): TrinoTarget {
  const segments = (database ?? '')
    .trim()
    .split(/[/.]/)
    .map((raw) => {
      const s = raw.trim()
      const quoted = s.length >= 2 && s.startsWith('"') && s.endsWith('"')
      return quoted ? s.slice(1, -1).trim() : s.toLowerCase()
    })
    .filter((s) => s.length > 0)

  const catalog = segments[0]
  const schema = segments[1]

  return {
    ...(catalog ? { catalog } : {}),
    ...(schema ? { schema } : {}),
  }
}

// ──────────────────────────────────────────────
// Client factory
// ──────────────────────────────────────────────

export function createTrinoClient(opts: TrinoClientOptions): Trino {
  const target = parseTrinoTarget(opts.database)
  const { catalog, schema } = target

  // The value goes straight into an axios `baseURL`: a host pasted with its
  // scheme ("https://trino.example.com") or a bare IPv6 literal would otherwise
  // build an unparseable URL and surface as an opaque ERR_INVALID_URL.
  const rawHost = (opts.host ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/+$/, '')
  const bareHost = rawHost || 'localhost'
  const host = bareHost.includes(':') && !bareHost.startsWith('[') ? `[${bareHost}]` : bareHost

  // `cleanHeaders()` in trino-client drops falsy header values, so an empty user
  // would remove X-Trino-User entirely and the coordinator answers
  // `401 Basic authentication or X-Trino-User must be sent`.
  const user = (opts.username ?? '').trim() || TRINO_FALLBACK_USER
  const server = `${opts.ssl ? 'https' : 'http'}://${host}:${opts.port || TRINO_DEFAULT_PORT}`

  const options: ConnectionOptions = {
    server,
    source: 'dblumi',
    ...(catalog ? { catalog } : {}),
    ...(schema ? { schema } : {}),
    // An empty password means "cluster without authentication": send X-Trino-User
    // only. A `BasicAuth` with an empty password is rejected by clusters that have
    // no authenticator, and omitting both makes the client fall back to
    // `process.env.USER` — undefined on Windows/Docker — which yields a 401.
    ...(opts.password
      ? { auth: new BasicAuth(user, opts.password) }
      : { extraHeaders: { 'X-Trino-User': user } }),
    // TLS verification is deliberately disabled: Trino coordinators are usually
    // internal hosts with a self-signed certificate. Tracked debt — this should
    // become a per-connection `sslStrict` toggle rather than a constant.
    ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  }

  const client = Trino.create(options)
  serverByClient.set(client, server)
  targetByClient.set(client, target)
  return client
}

// ──────────────────────────────────────────────
// Query execution
// ──────────────────────────────────────────────

/**
 * Runs a single statement and drains the whole result set.
 *
 * `target` overrides catalog/schema PER QUERY: the client instance is mutated by
 * `X-Trino-Set-Catalog` / `X-Trino-Set-Schema` response headers, so relying on its
 * initial state would drift between users sharing the same connection. When the
 * caller passes none, the target the client was created with is used — no call
 * site can silently fall back to the drifting instance state.
 */
export async function runTrino(
  client: Trino,
  sql: string,
  target?: TrinoTarget,
  opts?: { timeoutMs?: number; maxRows?: number },
): Promise<TrinoResult> {
  const query = sql.trim().replace(/;+$/, '').trim()
  if (!query) throw new Error('Empty SQL statement')

  const effectiveTarget = target ?? targetByClient.get(client) ?? {}
  const catalog = effectiveTarget.catalog
  const schema = effectiveTarget.schema
  const request: TrinoQuery = {
    query,
    ...(catalog ? { catalog } : {}),
    ...(schema ? { schema } : {}),
  }

  const timeoutMs = opts?.timeoutMs
  const maxRows = opts?.maxRows
  const deadline = timeoutMs !== undefined && timeoutMs > 0 ? Date.now() + timeoutMs : null

  let queryId: string | undefined
  let state: string | undefined
  let updateCount: number | undefined
  let columns: QueryColumn[] = []
  const data: unknown[][] = []
  let sawChunk = false
  let truncated = false

  try {
    const iterator = await withDeadline(client.query(request), deadline)

    // `QueryIterator.next()` never yields the POST response — its first call
    // already follows `nextUri`. Read the id the POST returned so a deadline hit
    // during the first round-trip can still cancel the statement server-side.
    queryId = readInitialQueryId(iterator) ?? queryId

    // NEVER `while (true) { handle; if (done) break }`: the terminal chunk is
    // yielded with `done:false` and then handed back with `done:true`.
    let step = await withDeadline(iterator.next(), deadline)

    while (!step.done) {
      const chunk = step.value as TrinoChunk
      sawChunk = true

      // Trino reports SQL failures with HTTP 200 — without this the caller would
      // silently receive an empty, "successful" result set.
      if (chunk.error) throw new TrinoQueryError(chunk.error)

      if (chunk.id) queryId = chunk.id
      if (chunk.stats?.state) state = chunk.stats.state

      // `updateCount` is sent for DML but is absent from the package's types.
      const reported = (chunk as unknown as { updateCount?: unknown }).updateCount
      if (typeof reported === 'number') updateCount = reported

      if (columns.length === 0 && chunk.columns && chunk.columns.length > 0) {
        columns = chunk.columns.map((col) => ({ name: col.name, dataType: col.type }))
      }

      for (const raw of chunk.data ?? []) {
        if (maxRows !== undefined && data.length >= maxRows) {
          truncated = true
          break
        }
        data.push(raw as unknown[])
      }

      if (truncated) break
      if (deadline !== null && Date.now() > deadline) throw new TrinoDeadlineExceeded()

      step = await withDeadline(iterator.next(), deadline)
    }

    if (truncated && queryId) {
      await cancelQuietly(client, queryId)
    }

    if (!sawChunk) {
      // Nothing was yielded: the POST /v1/statement payload was not a Trino
      // response at all (reverse proxy, HTML error page, wrong port...).
      const tail = step.value as TrinoChunk | undefined
      if (tail && typeof tail === 'object' && tail.error) throw new TrinoQueryError(tail.error)
      throw new Error('Réponse inattendue du coordinateur Trino (payload /v1/statement invalide).')
    }
  } catch (err) {
    if (err instanceof TrinoDeadlineExceeded) {
      if (queryId) await cancelQuietly(client, queryId)
      throw new Error(
        `Délai dépassé (${String(timeoutMs)} ms) en attendant le coordinateur Trino.`,
      )
    }
    if (err instanceof TrinoQueryError) throw err
    throw toTrinoConnectionError(err, serverByClient.get(client) ?? 'le coordinateur Trino')
  }

  if (columns.length === 0 && data.length > 0) {
    // A statement can return rows without column metadata (rare, but the chunk
    // carrying `columns` may have been swallowed): fabricate positional names.
    const width = data.reduce((max, row) => Math.max(max, row.length), 0)
    columns = Array.from({ length: width }, (_, i) => ({ name: `_col${i}`, dataType: 'unknown' }))
  }

  const rows: Record<string, unknown>[] = data.map((row) => {
    // Null prototype: a column literally named `__proto__` (legal in Trino via a
    // quoted identifier) would otherwise hit the prototype setter and vanish
    // from the JSON sent to the browser.
    const record = Object.create(null) as Record<string, unknown>
    columns.forEach((col, i) => {
      record[col.name] = row[i] ?? null
    })
    return record
  })

  return {
    columns,
    rows,
    data,
    rowCount: data.length,
    updateCount,
    truncated,
    queryId,
    state,
  }
}

/**
 * Liveness probe. Also validates BOTH halves of the target when the connection
 * pins one, so a typo fails at test time and not at browse time:
 * `SHOW SCHEMAS FROM <catalog>` errors out on an unknown catalog, and its own
 * result set is reused to check the schema. Without the second check a bad
 * schema surfaces nowhere — the schema browser would just look empty.
 */
export async function pingTrino(
  client: Trino,
  target?: TrinoTarget,
  timeoutMs: number = TRINO_PING_TIMEOUT_MS,
): Promise<void> {
  await runTrino(client, 'SELECT 1', {}, { timeoutMs })

  const catalog = target?.catalog
  if (!catalog) return

  const shown = await runTrino(
    client,
    `SHOW SCHEMAS FROM ${quoteTrinoIdent(catalog)}`,
    {},
    { timeoutMs },
  )

  const schema = target?.schema
  if (!schema) return
  // Trino normalises identifiers to lower case, so compare case-insensitively.
  const wanted = schema.toLowerCase()
  const known = shown.data.some((row) => String(row[0] ?? '').toLowerCase() === wanted)
  if (!known) {
    throw new Error(`Schéma '${schema}' introuvable dans le catalogue '${catalog}'.`)
  }
}

// ──────────────────────────────────────────────
// Quoting
// ──────────────────────────────────────────────

/** `a"b` → `"a""b"` */
export function quoteTrinoIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** `a'b` → `'a''b'` */
export function quoteTrinoString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Quotes EACH dotted segment: `sch.tbl` → `"sch"."tbl"`.
 * Introspection returns `schema.table` when no schema is pinned, so quoting the
 * whole string would produce an unknown table named `sch.tbl`.
 */
export function quoteTrinoTable(name: string): string {
  return name
    .split('.')
    .map((segment) => quoteTrinoIdent(segment))
    .join('.')
}

// ──────────────────────────────────────────────
// Error mapping
// ──────────────────────────────────────────────

type AxiosLikeError = {
  isAxiosError?: unknown
  code?: unknown
  message?: unknown
  response?: { status?: unknown; statusText?: unknown } | undefined
}

/**
 * Turns a transport failure into an explicit French message.
 * Anything that is not an axios error is returned untouched.
 *
 * Note: axios errors keep `name === 'Error'`, only `isAxiosError` is reliable.
 */
export function toTrinoConnectionError(err: unknown, server: string): Error {
  const candidate = (typeof err === 'object' && err !== null ? err : {}) as AxiosLikeError

  if (candidate.isAxiosError !== true) {
    return err instanceof Error ? err : new Error(String(err))
  }

  const status = typeof candidate.response?.status === 'number' ? candidate.response.status : null
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : String(err)

  if (status === 401) {
    return new Error(
      `Authentification refusée par le coordinateur Trino (${server}). Vérifiez l'utilisateur et le mot de passe.`,
    )
  }
  if (status === 403) {
    return new Error(`Accès refusé par le coordinateur Trino (${server}).`)
  }
  if (status !== null) {
    return new Error(
      `Le serveur ${server} a répondu HTTP ${status}. Vérifiez l'URL et le port du coordinateur Trino.`,
    )
  }
  if (code === 'ECONNREFUSED') {
    return new Error(
      `Connexion refusée par ${server}. Vérifiez que le coordinateur Trino est démarré et que le port est correct.`,
    )
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error(`Hôte introuvable (${server}). Vérifiez le nom d'hôte.`)
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return new Error(`Délai dépassé en contactant ${server}.`)
  }
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return new Error(`Certificat TLS refusé par ${server}.`)
  }

  return new Error(`Impossible de joindre le coordinateur Trino (${server}) : ${message}`)
}

// ──────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────

/**
 * Reads the query id carried by the initial POST /v1/statement response.
 *
 * `Trino.query()` wraps a `QueryIterator` holding that response, but the field is
 * `private` in the package's typings and never surfaces through `next()`. Reading
 * it defensively is the only way to know the id before the first chunk.
 */
function readInitialQueryId(iterator: unknown): string | undefined {
  const holder = iterator as { iter?: { queryResult?: { id?: unknown } } } | null
  const id = holder?.iter?.queryResult?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Best-effort server-side cancellation, bounded so it can never hang. */
async function cancelQuietly(client: Trino, queryId: string): Promise<void> {
  await withDeadline(client.cancel(queryId), Date.now() + TRINO_CANCEL_TIMEOUT_MS).catch(
    () => undefined,
  )
}

/**
 * `trino-client@0.2.9` sets no axios timeout, so a host dropping packets hangs
 * forever. This bounds every await on the coordinator.
 */
function withDeadline<T>(promise: Promise<T>, deadline: number | null): Promise<T> {
  if (deadline === null) return promise

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TrinoDeadlineExceeded()),
      Math.max(deadline - Date.now(), 0),
    )
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}
