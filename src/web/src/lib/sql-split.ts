/**
 * Splits a SQL string into individual statements at top-level `;` boundaries.
 *
 * Aware of:
 *   - line comments  -- ...
 *   - block comments / * ... * /
 *   - single-quoted strings (with '' escape and \' escape)
 *   - double-quoted identifiers / strings
 *   - backtick-quoted identifiers (MySQL)
 *   - PostgreSQL dollar-quoted strings $tag$ ... $tag$
 *
 * Returns trimmed, non-empty statements.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let buf = ''
  let i = 0

  const flush = () => {
    const t = buf.trim()
    // `SELECT 1; -- done` is one statement: a piece made only of comments is not a query.
    if (t.length > 0 && t.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, '').trim() !== '') statements.push(t)
    buf = ''
  }

  while (i < sql.length) {
    const ch = sql[i]!
    const next = sql[i + 1]

    // line comment
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        buf += sql[i++]
      }
      continue
    }

    // block comment
    if (ch === '/' && next === '*') {
      buf += sql[i++]!
      buf += sql[i++]!
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        buf += sql[i++]!
      }
      if (i < sql.length) {
        buf += sql[i++]!
        buf += sql[i++]!
      }
      continue
    }

    // single-quoted string
    if (ch === "'") {
      buf += sql[i++]!
      while (i < sql.length) {
        const c = sql[i]!
        if (c === '\\' && i + 1 < sql.length) {
          buf += sql[i++]!
          buf += sql[i++]!
          continue
        }
        if (c === "'") {
          if (sql[i + 1] === "'") {
            buf += sql[i++]!
            buf += sql[i++]!
            continue
          }
          buf += sql[i++]!
          break
        }
        buf += sql[i++]!
      }
      continue
    }

    // double-quoted identifier / string
    if (ch === '"') {
      buf += sql[i++]!
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            buf += sql[i++]!
            buf += sql[i++]!
            continue
          }
          buf += sql[i++]!
          break
        }
        buf += sql[i++]!
      }
      continue
    }

    // backtick-quoted identifier (MySQL)
    if (ch === '`') {
      buf += sql[i++]!
      while (i < sql.length && sql[i] !== '`') {
        buf += sql[i++]!
      }
      if (i < sql.length) buf += sql[i++]!
      continue
    }

    // PostgreSQL dollar-quoted string
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (m) {
        const tag = m[0]
        buf += tag
        i += tag.length
        const end = sql.indexOf(tag, i)
        if (end === -1) {
          buf += sql.slice(i)
          i = sql.length
        } else {
          buf += sql.slice(i, end + tag.length)
          i = end + tag.length
        }
        continue
      }
    }

    if (ch === ';') {
      flush()
      i++
      continue
    }

    buf += sql[i++]!
  }

  flush()
  return statements
}
