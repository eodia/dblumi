/**
 * Splits a MongoDB editor buffer into mongosh statements, one request each.
 *
 * Statements end at a top-level `;`, or at a newline when the next line starts
 * a new command (`db.`, `db[`, `show `) — mongosh accepts both. A chained call
 * on the next line (`.sort({…})`) continues the current statement.
 * Strings, template literals, comments and regex literals are skipped.
 */
export function splitMongoStatements(text: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let i = 0
  // Last significant character: tells a regex literal (`{ a: /x/ }`) from a division.
  let prev = ''

  const push = (end: number) => {
    const stmt = text.slice(start, end).trim()
    if (stmt && !isOnlyComments(stmt)) out.push(stmt)
  }

  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]

    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
      i++
      prev = c
      continue
    }
    if (c === '/' && (prev === '' || '(,:[{=!&|?;'.includes(prev))) {
      i++
      let inClass = false
      while (i < text.length && text[i] !== '\n') {
        const d = text[i]!
        if (d === '\\') { i += 2; continue }
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) break
        i++
      }
      i++
      while (i < text.length && /[a-z]/.test(text[i]!)) i++
      prev = '/'
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      push(i)
      start = i + 1
      prev = ''
      i++
      continue
    } else if (c === '\n' && depth === 0 && startsNewCommand(text, i + 1) && text.slice(start, i).trim()) {
      push(i)
      start = i + 1
      prev = ''
      i++
      continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  push(text.length)
  return out
}

function startsNewCommand(text: string, from: number): boolean {
  const rest = text.slice(from).replace(/^\s+/, '')
  return /^(db\s*[.[]|show\s+\w)/.test(rest)
}

function isOnlyComments(stmt: string): boolean {
  return stmt.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim() === ''
}
