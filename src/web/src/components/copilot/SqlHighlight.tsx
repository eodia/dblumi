import { useMemo } from 'react'

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER',
  'DROP', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
  'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'BETWEEN', 'LIKE', 'ILIKE',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
  'DEFAULT', 'CHECK', 'CASCADE', 'RESTRICT', 'ADD', 'COLUMN',
  'IF', 'ELSE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'WITH', 'RECURSIVE', 'RETURNING', 'CONFLICT', 'DO', 'NOTHING',
  'TRUE', 'FALSE', 'BOOLEAN', 'INTEGER', 'TEXT', 'VARCHAR', 'BIGINT',
  'SERIAL', 'TIMESTAMP', 'DATE', 'TIME', 'NUMERIC', 'FLOAT', 'DOUBLE',
  'TRIGGER', 'FUNCTION', 'PROCEDURE', 'EXECUTE', 'GRANT', 'REVOKE',
])

type Token = { type: 'keyword' | 'string' | 'number' | 'comment' | 'operator' | 'function' | 'text'; value: string }

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < sql.length) {
    // Single-line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const value = end === -1 ? sql.slice(i) : sql.slice(i, end)
      tokens.push({ type: 'comment', value })
      i += value.length
      continue
    }

    // Multi-line comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const value = end === -1 ? sql.slice(i) : sql.slice(i, end + 2)
      tokens.push({ type: 'comment', value })
      i += value.length
      continue
    }

    // String (single quote)
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") { j++; break }
        j++
      }
      tokens.push({ type: 'string', value: sql.slice(i, j) })
      i = j
      continue
    }

    // Number
    if (/\d/.test(sql[i]!) && (i === 0 || /[\s,()=<>!+\-*/]/.test(sql[i - 1]!))) {
      let j = i
      while (j < sql.length && /[\d.]/.test(sql[j]!)) j++
      tokens.push({ type: 'number', value: sql.slice(i, j) })
      i = j
      continue
    }

    // Word (keyword, function, or identifier)
    if (/[a-zA-Z_]/.test(sql[i]!)) {
      let j = i
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j]!)) j++
      const word = sql.slice(i, j)
      const upper = word.toUpperCase()

      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (j < sql.length && sql[j] === '(') {
        tokens.push({ type: 'function', value: word })
      } else {
        tokens.push({ type: 'text', value: word })
      }
      i = j
      continue
    }

    // Operators
    if (/[=<>!+\-*/%]/.test(sql[i]!)) {
      let j = i + 1
      if (j < sql.length && /[=<>]/.test(sql[j]!)) j++
      tokens.push({ type: 'operator', value: sql.slice(i, j) })
      i = j
      continue
    }

    // Everything else (whitespace, punctuation)
    tokens.push({ type: 'text', value: sql[i]! })
    i++
  }

  return tokens
}

const TOKEN_CLASSES: Record<Token['type'], string> = {
  keyword: 'text-[#c586c0]',    // purple — SQL keywords
  string: 'text-[#ce9178]',     // orange — strings
  number: 'text-[#b5cea8]',     // green — numbers
  comment: 'text-[#6a9955] italic', // green italic — comments
  operator: 'text-[#d4d4d4]',   // light gray
  function: 'text-[#dcdcaa]',   // yellow — function names
  text: 'text-[#9cdcfe]',       // light blue — identifiers
}

export function SqlHighlight({ code }: { code: string }) {
  const tokens = useMemo(() => tokenize(code), [code])

  return (
    <code className="text-xs font-mono">
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLASSES[t.type]}>{t.value}</span>
      ))}
    </code>
  )
}
