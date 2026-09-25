import { describe, it, expect, vi } from 'vitest'

// snowflake.ts logs through ../logger.js, which validates process.env at import time.
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const {
  isPrivateKey,
  normalizePrivateKey,
  parseSnowflakeTarget,
  sfExact,
  sfIdent,
  snowflakeAccount,
  snowflakeLiteral,
  snowflakeOptions,
  snowflakeTypeFromJson,
} = await import('./snowflake.js')

describe('snowflakeAccount', () => {
  it('extracts the account identifier from what users paste', () => {
    expect(snowflakeAccount('myorg-myaccount')).toBe('myorg-myaccount')
    expect(snowflakeAccount(' https://xy12345.eu-west-1.snowflakecomputing.com/console ')).toBe('xy12345.eu-west-1')
    expect(snowflakeAccount('MYORG-ACC.snowflakecomputing.com')).toBe('MYORG-ACC')
  })
})

describe('parseSnowflakeTarget', () => {
  it('reads DB, DB/SCHEMA and DB.SCHEMA', () => {
    expect(parseSnowflakeTarget('ANALYTICS')).toEqual({ database: 'ANALYTICS' })
    expect(parseSnowflakeTarget('analytics/public')).toEqual({ database: 'analytics', schema: 'public' })
    expect(parseSnowflakeTarget('SALES.RAW')).toEqual({ database: 'SALES', schema: 'RAW' })
    expect(parseSnowflakeTarget('')).toEqual({})
    expect(parseSnowflakeTarget(null)).toEqual({})
  })
})

describe('snowflakeOptions', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n'

  it('uses key-pair authentication when the secret is a PEM key', () => {
    expect(isPrivateKey(pem)).toBe(true)
    expect(isPrivateKey('hunter2')).toBe(false)
    const opts = snowflakeOptions({ driver: 'snowflake', host: 'org-acc', username: 'SVC', password: pem, ssl: true })
    expect(opts).toMatchObject({ account: 'org-acc', username: 'SVC', authenticator: 'SNOWFLAKE_JWT', privateKey: pem })
    expect(opts).not.toHaveProperty('password')
  })

  it('restores the line breaks of a key pasted in a password field', () => {
    const body = 'A'.repeat(100)
    const oneLine = `-----BEGIN ENCRYPTED PRIVATE KEY-----${body}-----END ENCRYPTED PRIVATE KEY-----`
    expect(normalizePrivateKey(oneLine)).toBe(
      `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'A'.repeat(64)}\n${'A'.repeat(36)}\n-----END ENCRYPTED PRIVATE KEY-----\n`,
    )
  })

  it('passes warehouse, role and target', () => {
    const opts = snowflakeOptions({
      driver: 'snowflake', host: 'org-acc', username: 'u', password: 'p', ssl: true,
      database: 'SALES/RAW', options: { warehouse: 'WH_XS', role: 'ANALYST' },
    })
    expect(opts).toMatchObject({ password: 'p', warehouse: 'WH_XS', role: 'ANALYST', database: 'SALES', schema: 'RAW' })
  })
})

describe('identifiers and literals', () => {
  it('lets Snowflake fold typed names, keeps reported names in their exact case', () => {
    expect(sfIdent('analytics')).toBe('analytics')
    expect(sfIdent('my db')).toBe('"my db"')
    expect(sfExact('ORDERS')).toBe('ORDERS')
    expect(sfExact('orders')).toBe('"orders"')
    expect(sfExact('Odd"Name')).toBe('"Odd""Name"')
  })

  it('escapes backslashes and quotes in string literals', () => {
    expect(snowflakeLiteral("it's C:\\temp")).toBe("'it''s C:\\\\temp'")
    expect(snowflakeLiteral(null)).toBe('NULL')
    expect(snowflakeLiteral(true)).toBe('TRUE')
    expect(snowflakeLiteral({ a: 1 })).toBe('\'{"a":1}\'')
  })

  it('turns SHOW COLUMNS JSON types into SQL types', () => {
    expect(snowflakeTypeFromJson('{"type":"FIXED","precision":38,"scale":2}')).toBe('NUMBER(38,2)')
    expect(snowflakeTypeFromJson('{"type":"TEXT","length":16777216}')).toBe('VARCHAR(16777216)')
    expect(snowflakeTypeFromJson('{"type":"REAL"}')).toBe('FLOAT')
    expect(snowflakeTypeFromJson('{"type":"TIMESTAMP_NTZ"}')).toBe('TIMESTAMP_NTZ')
    expect(snowflakeTypeFromJson('not json')).toBe('not json')
  })
})
