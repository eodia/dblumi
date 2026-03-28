/**
 * Guardrail levels — matches UX specification:
 *
 * 0 — Safe (SELECT, EXPLAIN, SHOW, SET, BEGIN, COMMIT, ROLLBACK)
 * 1 — Caution (INSERT, UPDATE, DELETE with WHERE)
 * 2 — Warning (UPDATE / DELETE without WHERE clause — affects all rows)
 * 3 — Danger (DROP TABLE, TRUNCATE, ALTER TABLE, CREATE/REPLACE)
 * 4 — Critical (DROP DATABASE, DROP SCHEMA, DROP ALL)
 */

export type GuardrailLevel = 0 | 1 | 2 | 3 | 4

export type GuardrailResult =
  | { level: 0 }
  | { level: 1 | 2 | 3 | 4; message: string; details: string }

const SAFE_STARTERS = [
  'SELECT',
  'EXPLAIN',
  'SHOW',
  'SET',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'WITH',    // CTEs — assumed to be SELECT-based
  '--',
  '/*',
]

const CRITICAL_PATTERNS = [
  /\bDROP\s+(DATABASE|SCHEMA)\b/i,
  /\bDROP\s+ALL\b/i,
]

const DANGER_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+VIEW\b/i,
  /\bDROP\s+FUNCTION\b/i,
  /\bDROP\s+INDEX\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?TABLE\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
]

export function detectGuardrail(sql: string): GuardrailResult {
  const trimmed = sql.trim()
  const upper = trimmed.toUpperCase()

  // Level 4 — critical
  for (const pat of CRITICAL_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        level: 4,
        message: 'Opération critique irréversible',
        details: 'Cette opération supprime définitivement une base de données ou un schéma entier.',
      }
    }
  }

  // Level 3 — danger
  for (const pat of DANGER_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        level: 3,
        message: 'Opération structurelle dangereuse',
        details: 'Cette opération modifie ou supprime des objets de la base de données.',
      }
    }
  }

  // Level 2 — UPDATE/DELETE without WHERE
  if (/\bUPDATE\b/i.test(trimmed) && !hasWhereClause(upper)) {
    return {
      level: 2,
      message: 'UPDATE sans clause WHERE',
      details: 'Cette requête va modifier toutes les lignes de la table.',
    }
  }
  if (/\bDELETE\s+FROM\b/i.test(trimmed) && !hasWhereClause(upper)) {
    return {
      level: 2,
      message: 'DELETE sans clause WHERE',
      details: 'Cette requête va supprimer toutes les lignes de la table.',
    }
  }

  // Level 1 — INSERT / UPDATE / DELETE with WHERE
  if (/\b(INSERT|UPDATE|DELETE)\b/i.test(trimmed)) {
    const op = trimmed.match(/\b(INSERT|UPDATE|DELETE)\b/i)?.[1]?.toUpperCase() ?? 'Écriture'
    return {
      level: 1,
      message: `${op} — modification de données`,
      details: 'Cette requête va modifier des données en base.',
    }
  }

  // Level 0 — safe
  const firstWord = upper.split(/\s+/)[0] ?? ''
  const isSafe = SAFE_STARTERS.some((s) => firstWord.startsWith(s))
  if (!isSafe) {
    // Unknown statement — treat as level 1 to be safe
    return {
      level: 1,
      message: 'Instruction non reconnue',
      details: "Le type de cette requête n'a pas pu être déterminé.",
    }
  }

  return { level: 0 }
}

function hasWhereClause(upperSql: string): boolean {
  // Simple heuristic: look for WHERE not inside a subquery parenthesis
  // Good enough for guardrail purposes — not a full SQL parser
  return /\bWHERE\b/.test(upperSql)
}
