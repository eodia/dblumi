/**
 * Guardrail levels — matches UX specification:
 *
 * 0 — Safe (SELECT, EXPLAIN, SHOW, SET, BEGIN, COMMIT, ROLLBACK)
 * 1 — Caution (INSERT, UPDATE, DELETE with WHERE)
 * 2 — Warning (UPDATE / DELETE without WHERE clause — affects all rows)
 * 3 — Danger (DROP TABLE, TRUNCATE, ALTER TABLE, CREATE/REPLACE)
 * 4 — Critical (DROP DATABASE, DROP SCHEMA, DROP ALL)
 */

import { mainKeyword, scanOptionsFor, splitStatements, topLevel } from './sql-scan.js'

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
  // Read-only / session statements (Trino, also valid on other engines).
  // CALL and ANALYZE are deliberately absent: `CALL <cat>.system.<proc>`
  // (expire_snapshots, vacuum, remove_orphan_files...) is destructive.
  // `USE` is deliberately absent too: it is not read-only, and it gets its own
  // branch in `detectGuardrail` below (a generic "unrecognised statement" would
  // be a lie). Verified against Trino 483: on a connection that pins a catalog
  // but no schema, `USE <cat>.<sch>` makes the coordinator answer with
  // `X-Trino-Set-Schema`, which trino-client writes back into the shared client
  // headers — every later query of every user borrowing that connection then
  // resolves against the new schema.
  'DESCRIBE',
  'DESC',
  'VALUES',
  'PREPARE',
  'DEALLOCATE',
  'RESET',
  // Snowflake: list the files of a stage.
  'LIST',
  'LS',
  // Comments are no longer "safe starters": they are blanked before analysis,
  // so `-- note\nGRANT …` is judged on GRANT.
]

const CRITICAL_PATTERNS = [
  /\bDROP\s+(DATABASE|SCHEMA)\b/i,
  /\bDROP\s+ALL\b/i,
  /\bDROP\s+CATALOG\b/i,
  // T-SQL: stops the whole SQL Server instance.
  /^SHUTDOWN\b/i,
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
  /\bCREATE\s+CATALOG\b/i,
  /\bDROP\s+MATERIALIZED\s+VIEW\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\b/i,
  /\bREFRESH\s+MATERIALIZED\s+VIEW\b/i,
  /\bALTER\s+(SCHEMA|VIEW|MATERIALIZED\s+VIEW)\b/i,
  /\bCALL\s+[\w."]*system\.\w+/i,
]

/**
 * Level of the most dangerous statement in `sql`. Literals, quoted identifiers
 * and comments are blanked first: `WHERE note = 'drop table'` is not a DROP,
 * and `SELECT 1; DROP TABLE t` is judged on its DROP.
 */
export function detectGuardrail(sql: string, driver = ''): GuardrailResult {
  let worst: GuardrailResult = { level: 0 }
  for (const statement of splitStatements(sql, scanOptionsFor(driver))) {
    const result = detectStatement(statement.masked, driver)
    if (result.level > worst.level) worst = result
  }
  return worst
}

/** UPDATE as a statement — not `FOR UPDATE`, `DO UPDATE`, `ON UPDATE`, `KEY UPDATE`. */
const UPDATE_STATEMENT = /(?<!\b(?:FOR|DO|ON|KEY)\s+)\bUPDATE\b/i

function detectStatement(masked: string, driver: string): GuardrailResult {
  const trimmed = masked.trim()
  const upper = trimmed.toUpperCase()
  // `EXPLAIN ANALYZE DELETE …` really deletes: judge the explained statement.
  const explained = trimmed.replace(/^EXPLAIN\b(?:\s+(?:ANALYZE|VERBOSE|QUERY\s+PLAN(?:\s+FOR)?|PLAN\s+FOR))*\s*(?:\([^)]*\))?/i, '')
  const keyword = mainKeyword(explained)
  // WHERE of the statement itself, not of a subquery (`SET a = (SELECT … WHERE …)`).
  const top = topLevel(explained.toUpperCase())

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

  // MERGE — checked before the UPDATE heuristic below, which would otherwise
  // match the `WHEN MATCHED THEN UPDATE` clause and report a misleading
  // "UPDATE sans clause WHERE".
  if (/\bMERGE\s+INTO\b/i.test(trimmed)) {
    return {
      level: 2,
      message: 'MERGE — fusion de données',
      details:
        'Cette requête insère, met à jour ou supprime des lignes selon la source fusionnée.',
    }
  }

  // Level 2 — UPDATE/DELETE without WHERE (Oracle also accepts `DELETE t` without FROM)
  if (keyword === 'UPDATE' && !hasWhereClause(top)) {
    return {
      level: 2,
      message: 'UPDATE sans clause WHERE',
      details: 'Cette requête va modifier toutes les lignes de la table.',
    }
  }
  if (keyword === 'DELETE' && !hasWhereClause(top)) {
    return {
      level: 2,
      message: 'DELETE sans clause WHERE',
      details: 'Cette requête va supprimer toutes les lignes de la table.',
    }
  }

  // Level 1 — INSERT / UPDATE / DELETE with WHERE (also inside a CTE or EXPLAIN ANALYZE)
  const write = trimmed.match(/\b(INSERT|DELETE|UPSERT|REPLACE\s+INTO)\b/i)?.[1] ?? (UPDATE_STATEMENT.test(trimmed) ? 'UPDATE' : null)
  if (write) {
    const op = write.toUpperCase().replace(/\s+INTO$/, '')
    return {
      level: 1,
      message: `${op} — modification de données`,
      details: 'Cette requête va modifier des données en base.',
    }
  }

  // `USE` — recognised, but confirmed rather than silently run. It re-binds the
  // catalog/schema of the CONNECTION (Trino replies with `X-Trino-Set-Catalog` /
  // `X-Trino-Set-Schema`), so it leaks to every other user of that connection.
  // The other drivers run it on a dedicated session, closed after the run.
  if (/^USE\b/i.test(trimmed)) {
    if (driver && driver !== 'trino') return { level: 0 }
    return {
      level: 2,
      message: 'USE — changement de catalogue/schéma',
      details:
        "Cette instruction re-cible la connexion partagée : les requêtes suivantes, y compris celles des autres utilisateurs de cette connexion, s'exécuteront sur le nouveau catalogue/schéma.",
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
