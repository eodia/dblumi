import { describe, it, expect } from 'vitest'
import { parseRedisCommand, quoteRedisArg, RedisCommandSyntaxError } from './redis-command.js'

describe('parseRedisCommand', () => {
  it('splits bare arguments on whitespace', () => {
    expect(parseRedisCommand('  HGETALL   user:42 ')).toEqual(['HGETALL', 'user:42'])
    expect(parseRedisCommand('SCAN 0 MATCH user:* COUNT 100')).toEqual(['SCAN', '0', 'MATCH', 'user:*', 'COUNT', '100'])
  })

  it('understands redis-cli double quotes and their escapes', () => {
    expect(parseRedisCommand('SET "key with space" "a\\"b\\\\c\\n"')).toEqual(['SET', 'key with space', 'a"b\\c\n'])
    expect(parseRedisCommand('SET k "\\x41\\x7a"')).toEqual(['SET', 'k', 'Az'])
    expect(parseRedisCommand('SET k ""')).toEqual(['SET', 'k', ''])
  })

  it('keeps single-quoted text literal except for \\\'', () => {
    expect(parseRedisCommand("SET k 'it\\'s \\n raw'")).toEqual(['SET', 'k', "it's \\n raw"])
  })

  it('skips comment and blank lines', () => {
    expect(parseRedisCommand('# first comment\n// second\n\nGET a')).toEqual(['GET', 'a'])
  })

  it('rejects unclosed quotes, glued quoted arguments and empty input', () => {
    expect(() => parseRedisCommand('SET k "open')).toThrow(RedisCommandSyntaxError)
    expect(() => parseRedisCommand('SET k "a"b')).toThrow(RedisCommandSyntaxError)
    expect(() => parseRedisCommand('# only a comment')).toThrow(RedisCommandSyntaxError)
  })
})

describe('quoteRedisArg', () => {
  it('leaves safe arguments bare', () => {
    expect(quoteRedisArg('user:42')).toBe('user:42')
    expect(quoteRedisArg('3.14')).toBe('3.14')
  })

  it('quotes and escapes anything else, and round-trips through the parser', () => {
    for (const value of ['', 'a b', 'say "hi"', 'back\\slash', 'line\nbreak\ttab', '\x01bin', 'accentué']) {
      const quoted = quoteRedisArg(value)
      expect(parseRedisCommand(`SET k ${quoted}`)).toEqual(['SET', 'k', value])
    }
  })
})
