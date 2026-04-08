import { readSSE } from './client'

export type SyncProgress = {
  phase: 'schema' | 'create' | 'insert' | 'table-done' | 'done' | 'error'
  table: string
  tableIndex: number
  totalTables: number
  rowsInserted: number
  totalRows: number
  error?: string
}

export type TableMapping = { source: string; target: string }

export type SyncOptions = {
  includeConstraints: boolean
  includeData: boolean
}

export async function executeSync(
  sourceConnectionId: string,
  targetConnectionId: string,
  tables: TableMapping[],
  options: SyncOptions,
  onProgress: (p: SyncProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  try {
    for await (const { event, data } of readSSE('/sync', { sourceConnectionId, targetConnectionId, tables, ...options })) {
      if (event === '__http') {
        const resp = data as { status: number; body: Record<string, unknown> }
        return { success: false, error: (resp.body['message'] ?? 'Sync failed') as string }
      }
      if (event === 'progress') {
        onProgress(data as SyncProgress)
      } else if (event === 'error') {
        return { success: false, error: (data as { message: string }).message }
      }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Connection lost' }
  }
}
