import { api } from './client'

export type DbDriver = 'postgresql' | 'mysql'

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
  columns: Array<{
    name: string
    dataType: string
    nullable: boolean
    primaryKey: boolean
  }>
}

export type SchemaFunction = {
  name: string
  kind: 'function' | 'procedure'
  return_type: string
  arguments: string
  language: string
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
}
