import { describe, it, expect } from 'vitest'
import { mssqlConfig, mssqlLiteral, mssqlTableRef, quoteMssql } from './mssql.js'

describe('mssqlConfig', () => {
  it('connects by host and port', () => {
    const config = mssqlConfig({ driver: 'mssql', host: 'db.local', port: 1434, username: 'sa', password: 'x', database: 'app', ssl: false })
    expect(config).toMatchObject({ server: 'db.local', port: 1434, user: 'sa', password: 'x', database: 'app' })
    expect(config.options).toMatchObject({ encrypt: false, trustServerCertificate: true })
  })

  it('targets a named instance without sending the port', () => {
    const config = mssqlConfig({ driver: 'mssql', host: 'srv\\SQLEXPRESS', port: 1433, username: 'sa', ssl: true })
    expect(config.server).toBe('srv')
    expect(config).not.toHaveProperty('port')
    expect(config.options).toMatchObject({ instanceName: 'SQLEXPRESS', encrypt: true })
  })
})

describe('T-SQL quoting', () => {
  it('brackets identifiers and resolves the dbo schema', () => {
    expect(quoteMssql('odd]name')).toBe('[odd]]name]')
    expect(mssqlTableRef('users')).toEqual({ schema: 'dbo', name: 'users', ref: '[dbo].[users]' })
    expect(mssqlTableRef('sales.orders')).toEqual({ schema: 'sales', name: 'orders', ref: '[sales].[orders]' })
  })

  it('writes Unicode strings, bits and binaries', () => {
    expect(mssqlLiteral("l'été")).toBe("N'l''été'")
    expect(mssqlLiteral(true)).toBe('1')
    expect(mssqlLiteral(null)).toBe('NULL')
    expect(mssqlLiteral('0xDEAD', 'varbinary')).toBe('0xDEAD')
    // Only binary columns get raw 0x…: in a text column it is text.
    expect(mssqlLiteral('0xDEAD', 'nvarchar')).toBe("N'0xDEAD'")
  })
})
