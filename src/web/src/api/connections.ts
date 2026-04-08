import { api } from './client'

export type DbDriver = 'postgresql' | 'mysql' | 'oracle'

export type Connection = {
  id: string
  name: string
  driver: DbDriver
  host: string
  port: number
  database: string
  username: string
  ssl: boolean
  color: string | null
  environment: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type CreateConnectionInput = {
  name: string
  driver: DbDriver
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: boolean
  color?: string
  environment?: string
}

export type SchemaTable = {
  name: string
  type?: 'table' | 'view'
  comment?: string
  columns: Array<{
    name: string
    dataType: string
    nullable: boolean
    primaryKey: boolean
  }>
  indexes?: Array<{ name: string; columns: string[]; unique: boolean }>
  foreignKeys?: Array<{ name: string; fields: string[]; referencedDatabase: string; referencedTable: string; referencedFields: string[]; onDelete: string; onUpdate: string }>
}

export type SchemaFunction = {
  name: string
  kind: 'function' | 'procedure'
  return_type: string
  arguments: string
  language: string
}

export type DbStats = {
  version: string | null
  encoding: string | null
  timezone: string | null
  sizePretty: string | null
  sizeBytes: number | null
}

export const connectionsApi = {
  list: () => api.get<{ connections: Connection[] }>('/connections'),
  get: (id: string) => api.get<{ connection: Connection }>(`/connections/${id}`),
  create: (data: CreateConnectionInput) =>
    api.post<{ connection: Connection }>('/connections', data),
  update: (id: string, data: Partial<CreateConnectionInput>) =>
    api.put<{ connection: Connection }>(`/connections/${id}`, data),
  delete: (id: string) => api.del<void>(`/connections/${id}`),
  test: (id: string) =>
    api.post<{ ok: boolean; latencyMs?: number; error?: string }>(`/connections/${id}/test`),
  testRaw: (data: { driver: DbDriver; host: string; port: number; database: string; username: string; password: string; ssl: boolean }) =>
    api.post<{ ok: boolean; latencyMs?: number; error?: string }>('/connections/test-raw', data),
  schema: (id: string) =>
    api.get<{ tables: SchemaTable[]; functions?: SchemaFunction[] }>(`/connections/${id}/schema`),
  getFunction: (id: string, name: string) =>
    api.get<{ function: SchemaFunction & { source: string; params: Array<{ name: string; type: string }> } }>(`/connections/${id}/function/${name}`),
  databases: (id: string) =>
    api.get<{ databases: string[] }>(`/connections/${id}/databases`),
  switchDatabase: (id: string, database: string) =>
    api.post<{ database: string }>(`/connections/${id}/switch-database`, { database }),
  createDatabase: (id: string, name: string) =>
    api.post<{ name: string }>(`/connections/${id}/create-database`, { name }),
  stats: (id: string) => api.get<DbStats>(`/connections/${id}/stats`),
  getConnectionShares: (id: string) =>
    api.get<{ groups: Array<{ id: string; name: string; color: string | null }>; users: Array<{ id: string; name: string; email: string }> }>(`/connections/${id}/shares`),
  setConnectionShares: (id: string, groupIds: string[], userIds: string[]) =>
    api.put<{ groupIds: string[]; userIds: string[] }>(`/connections/${id}/shares`, { groupIds, userIds }),
  dump: async (id: string, tables: string[], includeData: boolean) => {
    const res = await fetch(`/api/v1/connections/${id}/dump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tables, includeData }),
    })
    if (!res.ok) throw new Error('Dump failed')
    return res.text()
  },
}
