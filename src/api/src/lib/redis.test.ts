import { describe, it, expect } from 'vitest'
import {
  assertRunnable,
  detectRedisGuardrail,
  dumpRedisPattern,
  executeRedis,
  flatPairs,
  keyGroup,
  redisDatabaseIndex,
  replyToRows,
  type RedisConn,
} from './redis.js'
import { parseRedisCommand } from './redis-command.js'

const level = (cmd: string) => detectRedisGuardrail(parseRedisCommand(cmd)).level

describe('detectRedisGuardrail', () => {
  it('lets reads through', () => {
    for (const cmd of ['GET a', 'HGETALL user:1', 'SCAN 0 MATCH *', 'CONFIG GET maxmemory', 'CLIENT LIST', 'INFO memory', 'XREAD BLOCK 0 STREAMS s $']) {
      expect(level(cmd), cmd).toBe(0)
    }
  })

  it('flags writes, scripts, KEYS, administration and wipes', () => {
    expect(level('SET a 1')).toBe(1)
    expect(level('DEL a b')).toBe(1)
    expect(level('EVAL "return 1" 0')).toBe(1)
    expect(level('KEYS *')).toBe(2)
    expect(level('CONFIG SET maxmemory 1gb')).toBe(3)
    expect(level('CLIENT KILL ID 12')).toBe(3)
    expect(level('flushdb')).toBe(4)
    expect(level('FLUSHALL ASYNC')).toBe(4)
    expect(level('SHUTDOWN NOSAVE')).toBe(4)
  })
})

describe('assertRunnable', () => {
  it('refuses commands that hijack the shared connection', () => {
    for (const cmd of ['SUBSCRIBE news', 'MONITOR', 'AUTH secret', 'QUIT']) {
      expect(() => assertRunnable(parseRedisCommand(cmd)), cmd).toThrow(/n'est pas supporté/)
    }
    expect(() => assertRunnable(['GET', 'a'])).not.toThrow()
  })
})

describe('replyToRows', () => {
  it('shapes hashes, sorted sets and scans as pairs', () => {
    expect(replyToRows(['HGETALL', 'h'], ['name', 'Ada', 'age', '36'])).toEqual([
      { field: 'name', value: 'Ada' },
      { field: 'age', value: '36' },
    ])
    expect(replyToRows(['ZRANGE', 'z', '0', '-1', 'WITHSCORES'], ['a', '1', 'b', '2'])).toEqual([
      { member: 'a', score: '1' },
      { member: 'b', score: '2' },
    ])
    expect(replyToRows(['HSCAN', 'h', '0'], ['0', ['f', 'v']])).toEqual([{ field: 'f', value: 'v' }])
    expect(replyToRows(['SSCAN', 's', '0'], ['0', ['m1', 'm2']])).toEqual([{ member: 'm1' }, { member: 'm2' }])
  })

  it('lists plain arrays with their index', () => {
    expect(replyToRows(['ZRANGE', 'z', '0', '-1'], ['a', 'b'])).toEqual([{ index: 0, value: 'a' }, { index: 1, value: 'b' }])
  })

  it('gives each stream entry its id and fields', () => {
    expect(replyToRows(['XRANGE', 's', '-', '+'], [['1-0', ['temp', '21', 'room', 'a']]])).toEqual([
      { id: '1-0', temp: '21', room: 'a' },
    ])
  })

  it('parses INFO into section / key / value rows', () => {
    expect(replyToRows(['INFO'], '# Server\r\nredis_version:7.2.4\r\n\r\n# Clients\r\nconnected_clients:3\r\n')).toEqual([
      { section: 'Server', key: 'redis_version', value: '7.2.4' },
      { section: 'Clients', key: 'connected_clients', value: '3' },
    ])
  })

  it('reads RESP3 pair shapes like their RESP2 flat form', () => {
    expect(flatPairs([['ada', 10], ['linus', 20]])).toEqual(['ada', 10, 'linus', 20])
    expect(flatPairs(new Map([['f', 'v']]))).toEqual(['f', 'v'])
    expect(flatPairs({ f: 'v' })).toEqual(['f', 'v'])
    expect(flatPairs(['a', '1'])).toEqual(['a', '1'])
    expect(replyToRows(['ZRANGE', 'z', '0', '-1', 'WITHSCORES'], [['ada', 10]])).toEqual([{ member: 'ada', score: 10 }])
  })

  it('wraps scalars, nil and RESP3 maps', () => {
    expect(replyToRows(['GET', 'a'], 'x')).toEqual([{ value: 'x' }])
    expect(replyToRows(['GET', 'missing'], null)).toEqual([{ value: null }])
    expect(replyToRows(['HGETALL', 'h'], new Map([['f', 'v']]))).toEqual([{ field: 'f', value: 'v' }])
  })
})

describe('keyGroup / redisDatabaseIndex', () => {
  it('groups keys by their first prefix', () => {
    expect(keyGroup('user:42:profile')).toBe('user:*')
    expect(keyGroup('counter')).toBe('*')
    expect(keyGroup(':odd')).toBe('*')
  })

  it('reads the database index, 0 when invalid', () => {
    expect(redisDatabaseIndex('3')).toBe(3)
    expect(redisDatabaseIndex('')).toBe(0)
    expect(redisDatabaseIndex('abc')).toBe(0)
    expect(redisDatabaseIndex(null)).toBe(0)
  })
})

/** In-memory keyspace answering the handful of commands the browser sends. */
function fakeRedis(data: Record<string, string | string[] | Record<string, string>>, ttl: Record<string, number> = {}): RedisConn & { sent: string[][] } {
  const keys = Object.keys(data).sort()
  const typeOf = (k: string) => {
    const v = data[k]
    return v === undefined ? 'none' : typeof v === 'string' ? 'string' : Array.isArray(v) ? 'list' : 'hash'
  }
  const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  const conn = {
    sent: [] as string[][],
    async sendCommand<T>(args: string[]): Promise<T> {
      conn.sent.push(args)
      const [name, a1] = [args[0]!.toUpperCase(), args[1]!]
      const reply = (() => {
        switch (name) {
          case 'SCAN': {
            // Two keys per iteration, to exercise the cursor walk.
            const cursor = Number(a1)
            const m = args.indexOf('MATCH')
            const re = glob(m > 0 ? args[m + 1]! : '*')
            const slice = keys.slice(cursor, cursor + 2).filter((k) => re.test(k))
            const next = cursor + 2 >= keys.length ? '0' : String(cursor + 2)
            return [next, slice]
          }
          case 'KEYS': return keys.filter((k) => glob(a1).test(k))
          case 'DBSIZE': return keys.length
          case 'TYPE': return typeOf(a1)
          case 'TTL': return ttl[a1] ?? -1
          case 'STRLEN': return (data[a1] as string).length
          case 'GET': return data[a1] ?? null
          case 'LLEN': return (data[a1] as string[]).length
          case 'HLEN': return Object.keys(data[a1] as object).length
          case 'LRANGE': return data[a1]
          case 'HGETALL': return Object.entries(data[a1] as object).flat()
          case 'SET': return 'OK'
          default: throw new Error(`unexpected ${name}`)
        }
      })()
      return reply as T
    },
    duplicate: () => conn,
    connect: async () => conn,
    close: async () => {},
    destroy: () => {},
    on: () => conn,
  }
  return conn
}

describe('executeRedis', () => {
  const data = {
    'user:1': 'Ada',
    'user:2': 'Linus',
    'user:3': { name: 'Grace' },
    'queue:jobs': ['a', 'b', 'c'],
    counter: '7',
  }

  it('walks the SCAN cursor to fill a page and describes each key', async () => {
    const client = fakeRedis(data, { 'user:1': 60 })
    const result = await executeRedis(client, parseRedisCommand('SCAN 0 MATCH user:*'), 100, 0)
    expect(result.rows).toEqual([
      { key: 'user:1', type: 'string', ttl: 60, size: 3, value: 'Ada' },
      { key: 'user:2', type: 'string', ttl: -1, size: 5, value: 'Linus' },
      { key: 'user:3', type: 'hash', ttl: -1, size: 1, value: null },
    ])
    // The whole keyspace was walked: the total is known without another count.
    expect(result.total).toBe(3)
    expect(result.columns.map((c) => c.name)).toEqual(['key', 'type', 'ttl', 'size', 'value'])
  })

  it('pages and sorts keys', async () => {
    const client = fakeRedis(data)
    const page = await executeRedis(client, ['SCAN', '0'], 2, 2)
    expect(page.rows.map((r) => r['key'])).toEqual(['user:1', 'user:2'])
    expect(page.total).toBe(5)
    const sorted = await executeRedis(client, ['SCAN', '0'], 2, 0, [{ column: 'key', direction: 'desc' }])
    expect(sorted.rows.map((r) => r['key'])).toEqual(['user:3', 'user:2'])
  })

  it('shapes a plain command reply and reports its total', async () => {
    const client = fakeRedis(data)
    const result = await executeRedis(client, ['LRANGE', 'queue:jobs', '0', '-1'], 2, 0)
    expect(result.rows).toEqual([{ index: 0, value: 'a' }, { index: 1, value: 'b' }])
    expect(result.total).toBe(3)
  })
})

describe('dumpRedisPattern', () => {
  it('writes redis-cli commands that recreate the keys', async () => {
    const client = fakeRedis({ 'user:1': 'Ada Lovelace', 'user:2': { name: 'Grace' } }, { 'user:1': 120 })
    const dump = await dumpRedisPattern(client, 'user:*', true)
    expect(dump).toContain('SET user:1 "Ada Lovelace"')
    expect(dump).toContain('EXPIRE user:1 120')
    expect(dump).toContain('HSET user:2 name Grace')
  })
})
