import { splitSqlStatements } from '@/lib/sql-split'

/** `GO` (or `GO 5`) alone on its line: the batch separator of sqlcmd and SSMS — not T-SQL. */
const GO_LINE = /^[ \t]*GO(?:[ \t]+\d+)?[ \t]*(?:--.*)?\r?$/i

/**
 * What only lives for the whole batch: variables, routine / trigger / view
 * bodies (which must also open their batch), BEGIN … END blocks, labels.
 * Such a batch is run as one statement; splitting it on `;` would break it.
 */
const BATCH_SCOPED =
  /\bDECLARE\s+@|\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROC|PROCEDURE|FUNCTION|TRIGGER|VIEW)\b|\bBEGIN\b(?!\s+(?:TRAN|TRANSACTION|DISTRIBUTED)\b)|\bGOTO\b/i

/** Comments, strings and [identifiers] blanked out, so that keywords inside them do not count. */
function codeOnly(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|N?'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"/g, ' ')
}

/**
 * SQL Server script → statements. `GO` lines separate batches; a batch holding
 * variables or a routine body stays whole, any other batch is split on `;`
 * so that each statement gets its own result tab.
 */
export function splitMssqlStatements(text: string): string[] {
  const batches: string[] = []
  let current: string[] = []
  const flush = () => {
    const batch = current.join('\n').trim()
    if (batch) batches.push(batch)
    current = []
  }
  for (const line of text.split('\n')) {
    if (GO_LINE.test(line)) flush()
    else current.push(line)
  }
  flush()
  return batches.flatMap((batch) =>
    BATCH_SCOPED.test(codeOnly(batch)) ? [batch.replace(/;\s*$/, '')] : splitSqlStatements(batch),
  )
}
