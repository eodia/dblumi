import { StreamLanguage } from '@codemirror/language'
import type { Completion, CompletionContext } from '@codemirror/autocomplete'
import type { SchemaTable } from '@/api/connections'

/**
 * redis-cli highlighting: the command (first word of a line), quoted
 * arguments, numbers, and `#` / `//` comment lines.
 */
export const redisLanguage = StreamLanguage.define<{ lineStart: boolean }>({
  name: 'redis',
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true
    if (stream.eatSpace()) return null
    if (state.lineStart && (stream.match('#') || stream.match('//'))) {
      stream.skipToEnd()
      return 'comment'
    }
    const first = state.lineStart
    state.lineStart = false
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
    if (stream.match(/^-?\d+(?:\.\d+)?(?=\s|$)/)) return 'number'
    stream.match(/^\S+/)
    return first ? 'keyword' : null
  },
  languageData: { commentTokens: { line: '#' } },
})

/** Common commands with their argument hint, offered at the start of a line. */
const REDIS_COMMANDS: Array<[string, string]> = [
  ['GET', 'key'], ['SET', 'key value [EX seconds] [NX|XX] [KEEPTTL]'], ['MGET', 'key [key …]'], ['DEL', 'key [key …]'],
  ['EXISTS', 'key'], ['TYPE', 'key'], ['TTL', 'key'], ['EXPIRE', 'key seconds'], ['PERSIST', 'key'], ['RENAME', 'key newkey'],
  ['SCAN', '0 MATCH pattern COUNT 1000'], ['KEYS', 'pattern'], ['DBSIZE', ''], ['INCR', 'key'], ['INCRBY', 'key n'], ['STRLEN', 'key'],
  ['HGETALL', 'key'], ['HGET', 'key field'], ['HSET', 'key field value [field value …]'], ['HDEL', 'key field'], ['HKEYS', 'key'], ['HLEN', 'key'], ['HSCAN', 'key 0'],
  ['LRANGE', 'key 0 -1'], ['LPUSH', 'key value'], ['RPUSH', 'key value'], ['LPOP', 'key'], ['RPOP', 'key'], ['LLEN', 'key'],
  ['SMEMBERS', 'key'], ['SADD', 'key member'], ['SREM', 'key member'], ['SCARD', 'key'], ['SISMEMBER', 'key member'], ['SSCAN', 'key 0'],
  ['ZRANGE', 'key 0 -1 WITHSCORES'], ['ZADD', 'key score member'], ['ZREM', 'key member'], ['ZSCORE', 'key member'], ['ZCARD', 'key'], ['ZSCAN', 'key 0'],
  ['XRANGE', 'key - +'], ['XADD', 'key * field value'], ['XLEN', 'key'], ['XINFO', 'STREAM key'],
  ['INFO', '[section]'], ['CONFIG', 'GET parameter'], ['CLIENT', 'LIST'], ['SLOWLOG', 'GET 10'], ['MEMORY', 'USAGE key'], ['PING', ''],
  ['JSON.GET', 'key [path]'], ['FT.SEARCH', 'index query'],
]

/** Commands at line start; key prefixes of the schema browser (`user:`) anywhere else. */
export function buildRedisCompletions(tables: SchemaTable[]): (ctx: CompletionContext) => { from: number; options: Completion[] } | null {
  const commands: Completion[] = REDIS_COMMANDS.map(([label, args]) => ({ label, type: 'keyword', ...(args ? { detail: args } : {}), apply: `${label} ` }))
  const prefixes: Completion[] = tables
    .filter((t) => t.name !== '*')
    .map((t) => ({ label: t.name.replace(/\*$/, ''), type: 'variable', detail: t.comment ?? '' }))
  return (ctx: CompletionContext) => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = line.text.slice(0, ctx.pos - line.from)
    const word = ctx.matchBefore(/[^\s"']*$/)
    if (!word) return null
    if (/^\s*[^\s]*$/.test(before)) {
      if (before.trim().startsWith('#') || before.trim().startsWith('//')) return null
      return word.from < word.to || ctx.explicit ? { from: word.from, options: commands } : null
    }
    return word.from < word.to || ctx.explicit ? { from: word.from, options: prefixes } : null
  }
}
