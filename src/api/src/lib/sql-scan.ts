/**
 * Lexical helpers for the guardrail and the pagination rewrite.
 *
 * Both used to run regexes on raw SQL, so a keyword inside a string literal
 * (`WHERE note = 'drop table'`), a comment (`-- LIMIT 5`) or a subquery
 * (`FROM (SELECT … LIMIT 5) x`) was mistaken for a clause of the statement.
 * These helpers never parse SQL; they only blank out what regexes must ignore.
 */

export type ScanOptions = {
  /** MySQL: `\'` escapes a quote inside a string literal. */
  backslashEscapes?: boolean
  /** PostgreSQL: `$tag$ … $tag$` literals. */
  dollarQuotes?: boolean
  /** MySQL: `# …` line comments. */
  hashComments?: boolean
  /** PostgreSQL: `E'…'` literals, where `\'` escapes a quote. */
  eStrings?: boolean
  /** Oracle: `q'[…]'` alternative-quoting literals. */
  qQuotes?: boolean
  /** SQL Server: `[bracketed identifiers]`, where `]]` escapes `]`. */
  bracketIdentifiers?: boolean
  /** Snowflake: `// …` line comments. */
  slashComments?: boolean
}

export function scanOptionsFor(driver: string): ScanOptions {
  return {
    backslashEscapes: driver === 'mysql' || driver === 'snowflake',
    dollarQuotes: driver === 'postgresql' || driver === 'snowflake',
    hashComments: driver === 'mysql',
    eStrings: driver === 'postgresql',
    qQuotes: driver === 'oracle',
    bracketIdentifiers: driver === 'mssql',
    slashComments: driver === 'snowflake',
  }
}

const Q_CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' }

/**
 * Same-length copy of `sql` where comments and the CONTENT of string literals /
 * quoted identifiers are replaced by spaces (quotes are kept, newlines too).
 * Offsets in the result are offsets in the original text.
 */
export function maskSql(sql: string, opts: ScanOptions = {}): string {
  const out = sql.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  const n = sql.length
  const isIdentChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9_$]/.test(ch)
  while (i < n) {
    const c = sql[i]!
    const next = sql[i + 1]
    if ((c === '-' && next === '-') || (c === '#' && opts.hashComments) || (c === '/' && next === '/' && opts.slashComments)) {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? n : end
      blank(i, stop)
      i = stop
    } else if ((c === 'q' || c === 'Q') && next === "'" && opts.qQuotes && !isIdentChar(sql[i - 1]) && i + 2 < n) {
      // q'[ … ]' — the quote character is free inside; only `]'` ends it.
      const open = sql[i + 2]!
      const terminator = (Q_CLOSERS[open] ?? open) + "'"
      const end = sql.indexOf(terminator, i + 3)
      const stop = end === -1 ? n : end + 2
      blank(i + 2, end === -1 ? n : end + 1)
      i = stop
    } else if (c === '[' && opts.bracketIdentifiers) {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ']') {
          if (sql[j + 1] === ']') { j += 2; continue }
          break
        }
        j++
      }
      blank(i + 1, Math.min(j, n))
      i = j + 1
    } else if ((c === 'E' || c === 'e') && next === "'" && opts.eStrings && !isIdentChar(sql[i - 1])) {
      let j = i + 2
      while (j < n) {
        if (sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      blank(i + 2, Math.min(j, n))
      i = j + 1
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      blank(i, stop)
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n) {
        const d = sql[j]!
        if (d === '\\' && opts.backslashEscapes && c !== '`') {
          j += 2
          continue
        }
        if (d === c) {
          if (sql[j + 1] === c) {
            j += 2 // doubled quote = escaped quote
            continue
          }
          break
        }
        j++
      }
      blank(i + 1, Math.min(j, n))
      i = j + 1
    } else if (c === '$' && opts.dollarQuotes) {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (!m) {
        i++
        continue
      }
      const tag = m[0]
      const end = sql.indexOf(tag, i + tag.length)
      const stop = end === -1 ? n : end + tag.length
      blank(i + tag.length, end === -1 ? n : end)
      i = stop
    } else {
      i++
    }
  }
  return out.join('')
}

/** Masked text with everything nested inside parentheses blanked (parentheses kept). */
export function topLevel(masked: string): string {
  let depth = 0
  let out = ''
  for (const c of masked) {
    if (c === '(') {
      depth++
      out += depth === 1 ? '(' : ' '
    } else if (c === ')') {
      out += depth === 1 ? ')' : ' '
      depth = Math.max(0, depth - 1)
    } else {
      out += depth > 0 && c !== '\n' ? ' ' : c
    }
  }
  return out
}

export type Statement = { text: string; masked: string }

/**
 * Splits on `;` outside literals and comments. Pieces made only of whitespace
 * and comments are dropped (`SELECT 1; -- done` is one statement).
 */
export function splitStatements(sql: string, opts: ScanOptions = {}): Statement[] {
  const masked = maskSql(sql, opts)
  const out: Statement[] = []
  let start = 0
  const push = (end: number) => {
    const m = masked.slice(start, end)
    if (m.trim()) out.push({ text: sql.slice(start, end).trim(), masked: m.trim() })
  }
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ';') {
      push(i)
      start = i + 1
    }
  }
  push(masked.length)
  return out
}

const MAIN_KEYWORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE', 'UPSERT', 'REPLACE'])

/**
 * Leading keyword of a (masked) statement, looking through a `WITH …` clause:
 * `WITH a AS (…) INSERT INTO …` is an INSERT, not a query.
 */
export function mainKeyword(masked: string): string | null {
  const words = topLevel(masked).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  const first = words[0]?.toUpperCase() ?? null
  if (first !== 'WITH') return first
  for (const w of words.slice(1)) {
    const u = w.toUpperCase()
    if (MAIN_KEYWORDS.has(u)) return u
  }
  return null
}

/** Index where the trailing `;`, whitespace and comments of a masked statement start. */
export function effectiveEnd(masked: string): number {
  return masked.replace(/[\s;]+$/, '').length
}

/**
 * Where `sql` can be cut to drop its trailing `;` and comments — but only if
 * what is cut really is whitespace, `;` and COMPLETE comments. A syntax the
 * scanner does not know (an unusual literal) would otherwise look like a
 * literal running to the end of the text, and cutting it would drop the real
 * end of the statement: its WHERE clause included.
 */
export function safeEnd(sql: string, masked: string): number {
  const end = effectiveEnd(masked)
  const tail = sql.slice(end)
  const onlyNoise = /^(?:\s|;|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(tail)
  return onlyNoise ? end : sql.replace(/[\s;]+$/, '').length
}
