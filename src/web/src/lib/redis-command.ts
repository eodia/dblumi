/**
 * redis-cli text helpers. The API parses and runs the commands
 * (src/api/src/lib/redis-command.ts); the client only writes and splits them.
 */

/** Blank lines and `#` / `//` comments carry no command. */
export function isRedisComment(line: string): boolean {
  const t = line.trim()
  return t === '' || t.startsWith('#') || t.startsWith('//')
}

/** One command per line, as in redis-cli. */
export function splitRedisCommands(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => !isRedisComment(l))
}

/** redis-cli argument: bare when safe, double-quoted and escaped otherwise. */
export function quoteRedisArg(arg: string): string {
  if (arg !== '' && /^[A-Za-z0-9_:.\-*@/+=]+$/.test(arg)) return arg
  let out = '"'
  for (const ch of arg) {
    const code = ch.charCodeAt(0)
    if (ch === '"' || ch === '\\') out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return `${out}"`
}

/** A key matched literally by SCAN MATCH: glob characters are escaped. */
export function globEscape(key: string): string {
  return key.replace(/[*?[\]\\]/g, '\\$&')
}

/** SQL LIKE pattern → Redis glob (`%` → `*`, `_` → `?`). */
export function likeToGlob(pattern: string): string {
  let out = ''
  for (const ch of pattern) {
    if (ch === '%') out += '*'
    else if (ch === '_') out += '?'
    else out += globEscape(ch)
  }
  return out
}
