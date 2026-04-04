import { api } from './client'

export type DbUser = {
  username: string
  host?: string
  plugin?: string
  status?: string
}

export type TablePrivilege = {
  database: string
  table: string
  privileges: string[]
}

export type DbUserPrivileges = {
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: {
    maxQueriesPerHour?: number
    maxUpdatesPerHour?: number
    maxConnectionsPerHour?: number
    maxUserConnections?: number
    connectionLimit?: number
    profile?: string
  }
}

export type CreateDbUserInput = {
  username: string
  host?: string
  password: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
}

export type UpdateDbUserInput = {
  host?: string
  password?: string
  serverPrivileges: Record<string, boolean>
  tablePrivileges: TablePrivilege[]
  advanced: DbUserPrivileges['advanced']
}

export const dbUsersApi = {
  list: (connectionId: string) =>
    api.get<{ users: DbUser[]; count: number }>(`/connections/${connectionId}/db-users`),

  getPrivileges: (connectionId: string, username: string, host?: string) => {
    const q = host ? `?host=${encodeURIComponent(host)}` : ''
    return api.get<DbUserPrivileges>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}/privileges${q}`)
  },

  create: (connectionId: string, input: CreateDbUserInput) =>
    api.post<{ ok: boolean }>(`/connections/${connectionId}/db-users`, input),

  update: (connectionId: string, username: string, input: UpdateDbUserInput) =>
    api.put<{ ok: boolean }>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}`, input),

  drop: (connectionId: string, username: string, host?: string) => {
    const q = host ? `?host=${encodeURIComponent(host)}` : ''
    return api.del<void>(`/connections/${connectionId}/db-users/${encodeURIComponent(username)}${q}`)
  },
}
