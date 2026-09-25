/**
 * redis-cli command line → argument list. Nothing is evaluated: the arguments
 * are sent as a raw command, like redis-cli does.
 *
 * Quoting follows redis-cli: "double quotes" understand \n \r \t \b \a \\ \"
 * and \xHH; 'single quotes' only \'. Lines starting with `#` or `//` are
 * comments (a dblumi convenience: one command per line in the editor).
 */

export class RedisCommandSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedisCommandSyntaxError'
  }
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07', '\\': '\\', '"': '"' }

export function isRedisComment(line: string): boolean {
  const t = line.trim()
  return t === '' || t.startsWith('#') || t.startsWith('//')
}

export function parseRedisCommand(input: string): string[] {
  const text = input.split('\n').filter((l) => !isRedisComment(l)).join(' ').trim()
  if (!text) throw new RedisCommandSyntaxError('Commande Redis attendue — par exemple GET ma_cle')
  const args: string[] = []
  let i = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++
    if (i >= text.length) break
    let arg = ''
    const quote = text[i]
    if (quote === '"' || quote === "'") {
      i++
      let closed = false
      while (i < text.length) {
        const c = text[i]!
        if (c === '\\' && quote === '"') {
          const next = text[i + 1]
          if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
            arg += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16))
            i += 4
          } else if (next !== undefined) {
            arg += ESCAPES[next] ?? next
            i += 2
          } else {
            i++
          }
          continue
        }
        if (c === '\\' && quote === "'" && text[i + 1] === "'") {
          arg += "'"
          i += 2
          continue
        }
        if (c === quote) {
          closed = true
          i++
          break
        }
        arg += c
        i++
      }
      if (!closed) throw new RedisCommandSyntaxError('Guillemets non fermés')
      if (i < text.length && !/\s/.test(text[i]!)) {
        throw new RedisCommandSyntaxError('Un argument entre guillemets doit être suivi d’un espace')
      }
    } else {
      while (i < text.length && !/\s/.test(text[i]!)) arg += text[i++]
    }
    args.push(arg)
  }
  return args
}

/** redis-cli representation of an argument: bare when safe, double-quoted and escaped otherwise. */
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
