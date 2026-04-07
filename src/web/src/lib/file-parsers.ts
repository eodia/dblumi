import * as XLSX from 'xlsx'
import { XMLParser } from 'fast-xml-parser'

export type ParsedData = {
  headers: string[]
  rows: (string | number | boolean | null)[][]
  sheetNames?: string[]
}

export type CsvOptions = {
  delimiter?: string | undefined
  hasHeader?: boolean | undefined
}

export type ExcelOptions = {
  sheetIndex?: number | undefined
}

export type JsonOptions = {
  arrayPath?: string | undefined
}

export type XmlOptions = {
  rowTag?: string | undefined
}

// ── Format detection ─────────────────────────

export type FileFormat = 'csv' | 'txt' | 'json' | 'xml' | 'xls' | 'xlsx'

export function detectFormat(fileName: string): FileFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'csv': return 'csv'
    case 'txt': case 'tsv': return 'txt'
    case 'json': return 'json'
    case 'xml': return 'xml'
    case 'xls': return 'xls'
    case 'xlsx': return 'xlsx'
    default: return null
  }
}

// ── CSV / TXT parsing ────────────────────────

function detectDelimiter(text: string): string {
  const firstLines = text.split('\n').slice(0, 5).join('\n')
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 }
  for (const char of Object.keys(counts)) {
    counts[char] = (firstLines.match(new RegExp(char === '|' ? '\\|' : char, 'g')) ?? []).length
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

export function parseCsv(text: string, options: CsvOptions = {}): ParsedData {
  const delimiter = options.delimiter ?? detectDelimiter(text)
  const hasHeader = options.hasHeader ?? true
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

  if (lines.length === 0) return { headers: [], rows: [] }

  const allRows = lines.map((line) => parseCsvLine(line, delimiter))
  const headers = hasHeader
    ? allRows[0]!.map((h) => h.trim() || `col_${Math.random().toString(36).slice(2, 6)}`)
    : allRows[0]!.map((_, i) => `column_${i + 1}`)
  const dataRows = hasHeader ? allRows.slice(1) : allRows

  const rows = dataRows.map((row) =>
    row.map((cell) => {
      const trimmed = cell.trim()
      if (trimmed === '' || trimmed.toLowerCase() === 'null') return null
      const num = Number(trimmed)
      if (!isNaN(num) && trimmed !== '') return num
      if (trimmed.toLowerCase() === 'true') return true
      if (trimmed.toLowerCase() === 'false') return false
      return trimmed
    }),
  )

  return { headers, rows }
}

// ── Excel parsing (XLS / XLSX) ───────────────

export function parseExcel(buffer: ArrayBuffer, options: ExcelOptions = {}): ParsedData {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetNames = workbook.SheetNames
  const sheetIndex = options.sheetIndex ?? 0
  const sheetName = sheetNames[sheetIndex]
  if (!sheetName) return { headers: [], rows: [], sheetNames }

  const sheet = workbook.Sheets[sheetName]!
  const jsonData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: null,
    rawNumbers: true,
  })

  if (jsonData.length === 0) return { headers: [], rows: [], sheetNames }

  const headerRow = jsonData[0]!
  const headers = headerRow.map((h, i) =>
    h != null && String(h).trim() ? String(h).trim() : `column_${i + 1}`,
  )
  const rows = jsonData.slice(1).filter((row) => row.some((cell) => cell != null && cell !== ''))

  return { headers, rows, sheetNames }
}

// ── JSON parsing ─────────────────────────────

function resolveJsonPath(data: unknown, path: string): unknown[] | null {
  if (!path) {
    return Array.isArray(data) ? data : null
  }
  const parts = path.split('.')
  let current: unknown = data
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return null
    }
  }
  return Array.isArray(current) ? current : null
}

function findArrayInObject(data: unknown): { path: string; array: unknown[] } | null {
  if (Array.isArray(data)) return { path: '', array: data }
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        return { path: key, array: value }
      }
    }
  }
  return null
}

export function parseJson(text: string, options: JsonOptions = {}): ParsedData {
  const data = JSON.parse(text)

  let array: unknown[]
  if (options.arrayPath) {
    const resolved = resolveJsonPath(data, options.arrayPath)
    if (!resolved) throw new Error(`Path "${options.arrayPath}" not found or is not an array`)
    array = resolved
  } else {
    const found = findArrayInObject(data)
    if (!found) throw new Error('No array found in JSON data')
    array = found.array
  }

  if (array.length === 0) return { headers: [], rows: [] }

  const headerSet = new Set<string>()
  for (const item of array) {
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        headerSet.add(key)
      }
    }
  }
  const headers = [...headerSet]

  const rows = array.map((item) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return headers.map((h) => {
      const val = obj[h]
      if (val === undefined || val === null) return null
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val
      return JSON.stringify(val)
    })
  })

  return { headers, rows }
}

// ── XML parsing ──────────────────────────────

function findRowElements(data: unknown): { tag: string; items: unknown[] } | null {
  if (!data || typeof data !== 'object') return null
  const entries = Object.entries(data as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (Array.isArray(value) && value.length > 0) {
      return { tag: key, items: value }
    }
    if (value && typeof value === 'object') {
      const nested = findRowElements(value)
      if (nested) return nested
    }
  }
  return null
}

export function parseXml(text: string, options: XmlOptions = {}): ParsedData {
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (_name: string, _jpath: unknown, isLeafNode: boolean) => !isLeafNode,
  })
  const data = parser.parse(text)

  let items: unknown[]
  if (options.rowTag) {
    const found = resolveJsonPath(data, options.rowTag)
    if (!found) throw new Error(`Row tag "${options.rowTag}" not found`)
    items = found
  } else {
    const found = findRowElements(data)
    if (!found) throw new Error('No repeating elements found in XML')
    items = found.items
  }

  const headerSet = new Set<string>()
  for (const item of items) {
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        headerSet.add(key)
      }
    }
  }
  const headers = [...headerSet]

  const rows = items.map((item) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return headers.map((h) => {
      const val = obj[h]
      if (val === undefined || val === null) return null
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val
      return String(val)
    })
  })

  return { headers, rows }
}

// ── Type inference ───────────────────────────

export type InferredType = 'text' | 'varchar' | 'integer' | 'bigint' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'float'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

export function inferColumnType(values: (string | number | boolean | null)[]): InferredType {
  const nonNull = values.filter((v): v is string | number | boolean => v != null)
  if (nonNull.length === 0) return 'text'

  if (nonNull.every((v) => typeof v === 'boolean')) return 'boolean'

  if (nonNull.every((v) => typeof v === 'number')) {
    if (nonNull.every((v) => Number.isInteger(v as number))) {
      return nonNull.some((v) => Math.abs(v as number) > 2_147_483_647) ? 'bigint' : 'integer'
    }
    return 'decimal'
  }

  const strings = nonNull.map((v) => String(v))
  if (strings.every((s) => TIMESTAMP_RE.test(s))) return 'timestamp'
  if (strings.every((s) => DATE_RE.test(s))) return 'date'

  const maxLen = Math.max(...strings.map((s) => s.length))
  return maxLen > 255 ? 'text' : 'varchar'
}

export function inferColumnTypes(headers: string[], rows: (string | number | boolean | null)[][]): InferredType[] {
  return headers.map((_, colIdx) => {
    const sample = rows.slice(0, 200).map((row) => row[colIdx] ?? null)
    return inferColumnType(sample)
  })
}

// ── Unified parse function ───────────────────

export async function parseFile(
  file: File,
  format: FileFormat,
  options?: CsvOptions & ExcelOptions & JsonOptions & XmlOptions,
): Promise<ParsedData> {
  if (format === 'csv' || format === 'txt') {
    const text = await file.text()
    return parseCsv(text, {
      delimiter: format === 'txt' ? (options?.delimiter ?? '\t') : options?.delimiter,
      hasHeader: options?.hasHeader,
    })
  }
  if (format === 'xls' || format === 'xlsx') {
    const buffer = await file.arrayBuffer()
    return parseExcel(buffer, { sheetIndex: options?.sheetIndex })
  }
  if (format === 'json') {
    const text = await file.text()
    return parseJson(text, { arrayPath: options?.arrayPath })
  }
  if (format === 'xml') {
    const text = await file.text()
    return parseXml(text, { rowTag: options?.rowTag })
  }
  throw new Error(`Unsupported format: ${format}`)
}
