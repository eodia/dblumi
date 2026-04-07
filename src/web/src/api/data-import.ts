import { readSSE, api } from './client'
import type { InferredType } from '@/lib/file-parsers'

export type ImportColumn = {
  name: string
  type: InferredType
}

export type ImportRequest = {
  connectionId: string
  tableName: string
  createTable: boolean
  ifExists: 'error' | 'append' | 'replace'
  columns: ImportColumn[]
  rows: (string | number | boolean | null)[][]
}

export type ImportProgress = {
  phase: 'create' | 'insert' | 'done'
  rowsInserted: number
  totalRows: number
  error?: string
}

export async function executeImport(
  request: ImportRequest,
  onProgress: (p: ImportProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  for await (const { event, data } of readSSE('/import', request)) {
    if (event === '__http') {
      const { body } = data as { status: number; body: { title?: string; message?: string } }
      return { success: false, error: body?.title ?? body?.message ?? 'Request failed' }
    }
    if (event === 'progress') {
      onProgress(data as ImportProgress)
    }
    if (event === 'error') {
      const { message } = data as { message: string }
      return { success: false, error: message }
    }
  }
  return { success: true }
}

export type ColumnMapping = {
  sourceColumn: string
  targetColumn: string | null
}

export async function mapColumns(
  sourceColumns: string[],
  targetColumns: Array<{ name: string; dataType: string }>,
): Promise<ColumnMapping[]> {
  const res = await api.post<{ mapping: ColumnMapping[] }>('/import/map-columns', {
    sourceColumns,
    targetColumns,
  })
  return res.mapping
}
