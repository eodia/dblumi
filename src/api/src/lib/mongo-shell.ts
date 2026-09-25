import {
  BSON,
  Binary,
  BSONRegExp,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'mongodb'

/**
 * Parser for the subset of mongosh syntax dblumi runs against MongoDB.
 *
 * Nothing is ever evaluated as JavaScript: the input is scanned into literal
 * values (objects, arrays, strings, numbers, regexes, BSON constructors such as
 * `ObjectId("…")`) and a call chain (`db.<collection>.<method>(…).<modifier>(…)`).
 * Method names are only collected here; the executor (`mongo.ts`) decides which
 * ones are allowed. Variables, functions and arbitrary expressions are rejected.
 */

export class MongoShellSyntaxError extends Error {
  constructor(message: string, public readonly position: number) {
    super(message)
    this.name = 'MongoShellSyntaxError'
  }
}

export type MongoCall = { method: string; args: unknown[] }

export type MongoCommand =
  | { kind: 'show'; target: 'dbs' | 'collections' }
  /** `db.<method>(…)` — database-level helpers (getCollectionNames, runCommand…). */
  | { kind: 'db'; database: string | null; call: MongoCall; chain: MongoCall[] }
  /** `db.<collection>.<method>(…).<modifier>(…)…` */
  | { kind: 'collection'; database: string | null; collection: string; call: MongoCall; chain: MongoCall[] }

/**
 * Single-key objects in MongoDB Extended JSON ({"$oid": "…"}, {"$date": "…"}…).
 * Accepted so that values copied from a result grid or an EJSON export can be
 * pasted back verbatim; none of these keys is a query operator.
 */
const EJSON_KEYS = new Set([
  '$oid', '$date', '$numberLong', '$numberInt', '$numberDouble', '$numberDecimal',
  '$binary', '$uuid', '$regularExpression', '$timestamp', '$minKey', '$maxKey',
  '$symbol', '$code',
])

const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/

class Scanner {
  pos = 0

  constructor(readonly src: string) {}

  fail(message: string, at = this.pos): never {
    throw new MongoShellSyntaxError(`${message} (position ${at + 1})`, at)
  }

  /** Skips whitespace and `//` / `/* *\/` comments. */
  skipTrivia(): void {
    const s = this.src
    while (this.pos < s.length) {
      const c = s[this.pos]!
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') {
        this.pos++
      } else if (c === '/' && s[this.pos + 1] === '/') {
        while (this.pos < s.length && s[this.pos] !== '\n') this.pos++
      } else if (c === '/' && s[this.pos + 1] === '*') {
        const end = s.indexOf('*/', this.pos + 2)
        if (end === -1) this.fail('Commentaire /* non fermé')
        this.pos = end + 2
      } else {
        return
      }
    }
  }

  peek(): string {
    this.skipTrivia()
    return this.src[this.pos] ?? ''
  }

  eof(): boolean {
    return this.peek() === ''
  }

  tryConsume(ch: string): boolean {
    if (this.peek() === ch) {
      this.pos++
      return true
    }
    return false
  }

  expect(ch: string, what = `'${ch}'`): void {
    if (!this.tryConsume(ch)) {
      const found = this.peek()
      this.fail(`${what} attendu, trouvé ${found ? `'${found}'` : 'fin de la commande'}`)
    }
  }

  readIdentifier(): string | null {
    this.skipTrivia()
    const s = this.src
    if (!IDENT_START.test(s[this.pos] ?? '')) return null
    const start = this.pos
    this.pos++
    while (this.pos < s.length && IDENT_PART.test(s[this.pos]!)) this.pos++
    return s.slice(start, this.pos)
  }

  readString(): string {
    this.skipTrivia()
    const s = this.src
    const quote = s[this.pos]
    if (quote !== '"' && quote !== "'" && quote !== '`') this.fail('Chaîne de caractères attendue')
    const start = this.pos
    this.pos++
    let out = ''
    while (this.pos < s.length) {
      const c = s[this.pos]!
      if (c === quote) {
        this.pos++
        return out
      }
      if (quote === '`' && c === '$' && s[this.pos + 1] === '{') {
        this.fail('Les expressions ${…} des templates ne sont pas supportées')
      }
      if ((c === '\n' || c === '\r') && quote !== '`') this.fail('Chaîne non fermée', start)
      if (c === '\\') {
        out += this.readEscape()
        continue
      }
      out += c
      this.pos++
    }
    this.fail('Chaîne non fermée', start)
  }

  private readEscape(): string {
    const s = this.src
    this.pos++ // backslash
    const c = s[this.pos]
    if (c === undefined) this.fail('Échappement incomplet')
    this.pos++
    switch (c) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case 'b': return '\b'
      case 'f': return '\f'
      case 'v': return '\v'
      case '0': return '\0'
      case '\r':
        if (s[this.pos] === '\n') this.pos++
        return ''
      case '\n': return '' // line continuation
      case 'x': {
        const hex = s.slice(this.pos, this.pos + 2)
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail('Échappement \\x invalide')
        this.pos += 2
        return String.fromCharCode(parseInt(hex, 16))
      }
      case 'u': {
        if (s[this.pos] === '{') {
          const end = s.indexOf('}', this.pos)
          const hex = end === -1 ? '' : s.slice(this.pos + 1, end)
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) this.fail('Échappement \\u{…} invalide')
          this.pos = end + 1
          return String.fromCodePoint(parseInt(hex, 16))
        }
        const hex = s.slice(this.pos, this.pos + 4)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Échappement \\u invalide')
        this.pos += 4
        return String.fromCharCode(parseInt(hex, 16))
      }
      default:
        return c
    }
  }

  readNumber(): number {
    this.skipTrivia()
    const rest = this.src.slice(this.pos)
    const m =
      rest.match(/^0[xX][0-9a-fA-F]+/) ??
      rest.match(/^0[oO][0-7]+/) ??
      rest.match(/^0[bB][01]+/) ??
      rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)
    if (!m) this.fail('Nombre attendu')
    this.pos += m[0].length
    if (IDENT_PART.test(this.src[this.pos] ?? '')) this.fail('Nombre invalide')
    return Number(m[0])
  }

  /** `/pattern/flags` — only called where a value is expected. */
  readRegex(): BSONRegExp {
    const s = this.src
    const start = this.pos
    this.pos++ // opening slash
    let pattern = ''
    let inClass = false
    while (this.pos < s.length) {
      const c = s[this.pos]!
      if (c === '\n' || c === '\r') break
      if (c === '\\') {
        pattern += c + (s[this.pos + 1] ?? '')
        this.pos += 2
        continue
      }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) {
        this.pos++
        let flags = ''
        while (this.pos < s.length && /[a-z]/.test(s[this.pos]!)) flags += s[this.pos++]
        return makeRegex(pattern, flags, start, this)
      }
      pattern += c
      this.pos++
    }
    this.fail('Expression régulière non fermée', start)
  }
}

/** Flags valid in BSON are i, m, s, u, x (l is legacy); JS-only g/y are dropped. */
function makeRegex(pattern: string, flags: string, at: number, scanner: Scanner): BSONRegExp {
  const invalid = flags.replace(/[imsuxgyld]/g, '')
  if (invalid) scanner.fail(`Option d'expression régulière invalide : '${invalid}'`, at)
  try {
    // Validates the pattern early: MongoDB's PCRE is close enough for syntax errors.
    new RegExp(pattern, flags.replace(/[xld]/g, ''))
  } catch {
    // PCRE-only syntax (possessive quantifiers…) — let the server decide.
  }
  const bsonFlags = [...new Set(flags.replace(/[gyd]/g, ''))].sort().join('')
  return new BSONRegExp(pattern, bsonFlags)
}

/**
 * Sets a key without ever touching the prototype chain: a literal
 * `{"__proto__": {...}}` must stay a plain field, not re-parent the object.
 */
function defineField(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

class Parser {
  constructor(private readonly s: Scanner) {}

  parseValue(ejson = true): unknown {
    const s: Scanner = this.s
    const c = s.peek()
    if (c === '') s.fail('Valeur attendue, trouvé fin de la commande')
    if (c === '{') return this.parseObject(ejson)
    if (c === '[') return this.parseArray(ejson)
    if (c === '"' || c === "'" || c === '`') return s.readString()
    if (c === '/') return s.readRegex()
    if (c === '-' || c === '+') {
      s.pos++
      const next = s.peek()
      let n: number
      if (next === 'I') {
        const id = s.readIdentifier()
        if (id !== 'Infinity') s.fail(`Nombre attendu après '${c}'`)
        n = Infinity
      } else {
        n = s.readNumber()
      }
      return c === '-' ? -n : n
    }
    if (/[0-9.]/.test(c)) return s.readNumber()

    const at = s.pos
    const ident = s.readIdentifier()
    if (ident === null) s.fail(`Caractère inattendu '${c}'`)
    switch (ident) {
      case 'true': return true
      case 'false': return false
      case 'null':
      case 'undefined': return null
      case 'NaN': return NaN
      case 'Infinity': return Infinity
      case 'new': {
        const ctor = s.readIdentifier()
        if (ctor === null) s.fail('Constructeur attendu après new')
        return this.parseConstructor(ctor, at)
      }
      default:
        if (s.peek() === '(') return this.parseConstructor(ident, at)
        s.fail(
          `Identifiant inattendu '${ident}' : les variables et expressions JavaScript ne sont pas supportées`,
          at,
        )
    }
  }

  parseArgs(): unknown[] {
    const s: Scanner = this.s
    s.expect('(')
    const args: unknown[] = []
    while (!s.tryConsume(')')) {
      args.push(this.parseValue())
      if (!s.tryConsume(',')) {
        s.expect(')', "',' ou ')'")
        break
      }
    }
    return args
  }

  private parseObject(ejson: boolean): Record<string, unknown> | unknown {
    const s: Scanner = this.s
    s.expect('{')
    const obj: Record<string, unknown> = {}
    const keys: string[] = []
    while (!s.tryConsume('}')) {
      const c = s.peek()
      let key: string
      if (c === '"' || c === "'" || c === '`') key = s.readString()
      else if (/[0-9]/.test(c)) key = String(s.readNumber())
      else {
        const id = s.readIdentifier()
        if (id === null) s.fail(`Nom de champ attendu, trouvé '${c}'`)
        key = id
      }
      s.expect(':')
      // Inside an EJSON wrapper the payload is plain JSON ({"$date": {"$numberLong": "…"}}).
      const isEjsonWrapper = ejson && EJSON_KEYS.has(key)
      defineField(obj, key, this.parseValue(!isEjsonWrapper && ejson))
      keys.push(key)
      if (!s.tryConsume(',')) {
        s.expect('}', "',' ou '}'")
        break
      }
    }
    if (ejson && keys.length === 1 && EJSON_KEYS.has(keys[0]!)) {
      try {
        return BSON.EJSON.deserialize({ v: obj }, { relaxed: false })['v']
      } catch (err) {
        s.fail(`Valeur Extended JSON invalide : ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return obj
  }

  private parseArray(ejson: boolean): unknown[] {
    const s: Scanner = this.s
    s.expect('[')
    const arr: unknown[] = []
    while (!s.tryConsume(']')) {
      arr.push(this.parseValue(ejson))
      if (!s.tryConsume(',')) {
        s.expect(']', "',' ou ']'")
        break
      }
    }
    return arr
  }

  private parseConstructor(name: string, at: number): unknown {
    const s: Scanner = this.s
    const args = s.peek() === '(' ? this.parseArgs() : []
    const str = (i: number, what: string): string => {
      const v = args[i]
      if (typeof v !== 'string') s.fail(`${name}() : ${what} attendu`, at)
      return v
    }
    const num = (i: number, what: string): number => {
      const v = args[i]
      if (typeof v === 'number') return v
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
      s.fail(`${name}() : ${what} attendu`, at)
    }
    try {
      switch (name) {
        case 'ObjectId':
        case 'ObjectID': {
          if (args.length === 0) return new ObjectId()
          const hex = str(0, 'identifiant hexadécimal de 24 caractères')
          if (!/^[0-9a-fA-F]{24}$/.test(hex)) s.fail(`ObjectId invalide : '${hex}'`, at)
          return new ObjectId(hex)
        }
        case 'ISODate':
        case 'Date': {
          if (args.length === 0) return new Date()
          const v = args[0]
          if (typeof v !== 'string' && typeof v !== 'number') s.fail(`${name}() : date ISO ou timestamp attendu`, at)
          const d = new Date(v)
          if (Number.isNaN(d.getTime())) s.fail(`Date invalide : '${String(v)}'`, at)
          return d
        }
        case 'NumberLong':
        case 'Long':
          return Long.fromString(String(args[0] ?? 0))
        case 'NumberInt':
        case 'Int32':
          return new Int32(num(0, 'entier'))
        case 'Double':
          return new Double(num(0, 'nombre'))
        case 'Number':
          return num(0, 'nombre')
        case 'NumberDecimal':
        case 'Decimal128':
          return Decimal128.fromString(String(args[0] ?? '0'))
        case 'UUID':
          return args.length === 0 ? new UUID() : new UUID(str(0, 'UUID'))
        case 'BinData': {
          const subtype = num(0, 'sous-type')
          return new Binary(Buffer.from(str(1, 'contenu base64'), 'base64'), subtype)
        }
        case 'Timestamp': {
          const first = args[0]
          if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
            const o = first as Record<string, unknown>
            return new Timestamp({ t: Number(o['t'] ?? 0), i: Number(o['i'] ?? 0) })
          }
          return new Timestamp({ t: num(0, 'secondes'), i: args.length > 1 ? num(1, 'incrément') : 0 })
        }
        case 'RegExp':
          return makeRegex(str(0, 'motif'), args.length > 1 ? str(1, 'options') : '', at, s)
        case 'MinKey':
          return new MinKey()
        case 'MaxKey':
          return new MaxKey()
        case 'Code':
          return new Code(str(0, 'code'))
        default:
          s.fail(`Fonction non supportée : ${name}()`, at)
      }
    } catch (err) {
      if (err instanceof MongoShellSyntaxError) throw err
      s.fail(`${name}() : ${err instanceof Error ? err.message : String(err)}`, at)
    }
  }
}

const SHOW_TARGETS: Record<string, 'dbs' | 'collections'> = {
  dbs: 'dbs',
  databases: 'dbs',
  collections: 'collections',
  tables: 'collections',
}

/**
 * Parses one mongosh statement. A trailing `;` is accepted; anything after it
 * is not — statements are split client-side, one request per statement.
 */
export function parseMongoCommand(input: string): MongoCommand {
  const s: Scanner = new Scanner(input)
  const p = new Parser(s)

  const first = s.readIdentifier()
  if (first === 'show') {
    const what = s.readIdentifier()
    const target = what ? SHOW_TARGETS[what] : undefined
    if (!target) s.fail('Utilisez show dbs ou show collections')
    finish(s)
    return { kind: 'show', target }
  }
  if (first === 'use') {
    s.fail("'use <base>' n'est pas supporté : changez de base avec le sélecteur de la connexion, ou utilisez db.getSiblingDB('<base>')", 0)
  }
  if (first !== 'db') {
    s.fail('Une commande MongoDB commence par db. — par exemple db.users.find({})', 0)
  }

  let database: string | null = null
  let collection: string | null = null
  let call: MongoCall | null = null
  const chain: MongoCall[] = []
  let names: string[] = []

  for (;;) {
    const c = s.peek()
    if (c === '.') {
      s.pos++
      const name = s.readIdentifier()
      if (name === null) s.fail('Nom de collection ou de méthode attendu après le point')
      names.push(name)
    } else if (c === '[' && call === null) {
      s.pos++
      names.push(s.readString())
      s.expect(']')
    } else if (c === '(') {
      const at = s.pos
      const args = p.parseArgs()
      if (names.length === 0) s.fail('Appel de méthode inattendu', at)
      if (call !== null) {
        if (names.length !== 1) s.fail(`Méthode inattendue : ${names.join('.')}`, at)
        chain.push({ method: names[0]!, args })
      } else if (collection === null && names.length === 1 && names[0] === 'getSiblingDB') {
        if (database !== null) s.fail('getSiblingDB() ne peut apparaître qu’une fois', at)
        if (typeof args[0] !== 'string' || !args[0]) s.fail('getSiblingDB() attend un nom de base', at)
        database = args[0]
      } else if (collection === null && names.length === 1 && names[0] === 'getCollection') {
        if (typeof args[0] !== 'string' || !args[0]) s.fail('getCollection() attend un nom de collection', at)
        collection = args[0]
      } else if (collection === null && names.length === 1) {
        call = { method: names[0]!, args }
      } else {
        // db.a.b.find() targets the collection "a.b", exactly like mongosh.
        const method = names[names.length - 1]!
        const prefix = names.slice(0, -1).join('.')
        collection = collection === null ? prefix : prefix ? `${collection}.${prefix}` : collection
        if (!collection) s.fail('Nom de collection vide', at)
        call = { method, args }
      }
      names = []
    } else {
      break
    }
  }

  if (names.length > 0 || call === null) {
    s.fail('Appel de méthode attendu — par exemple db.users.find({})')
  }
  finish(s)

  return collection === null
    ? { kind: 'db', database, call, chain }
    : { kind: 'collection', database, collection, call, chain }
}

function finish(s: Scanner): void {
  s.tryConsume(';')
  if (!s.eof()) {
    s.fail('Une seule commande par exécution : séparez les commandes par un point-virgule')
  }
}
