import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { AzureOpenAI } from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { decrypt } from '../lib/crypto.js'
import { parseTrinoTarget } from '../lib/trino.js'
import copilotI18n, { type CopilotLocale } from '../i18n/copilot.i18n.js'

export type SchemaTable = {
  name: string
  columns: Array<{ name: string; dataType: string; nullable: boolean; primaryKey: boolean }>
}

export class CopilotError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_API_KEY' | 'INVALID_KEY' | 'API_ERROR',
  ) {
    super(message)
    this.name = 'CopilotError'
  }
}

/** Détecte le provider actif depuis les variables d'environnement. */
export function getActiveProvider(): 'ollama' | 'anthropic' | 'mistral' | 'openai' | 'azure-openai' {
  const hasOllama = !!config.OLLAMA_BASE_URL
  const hasAnthropic = !!config.ANTHROPIC_API_KEY
  const hasMistral = !!config.MISTRAL_API_KEY
  const hasAzure = !!(config.AZURE_OPENAI_API_KEY && config.AZURE_OPENAI_ENDPOINT)
  const hasOpenai = !!config.OPENAI_API_KEY

  const count = [hasOllama, hasAnthropic, hasMistral, hasAzure, hasOpenai].filter(Boolean).length
  if (count > 1) {
    logger.warn('Multiple AI providers configured. Priority: ollama > anthropic > mistral > azure-openai > openai.')
  }

  if (hasOllama) return 'ollama'
  if (hasAnthropic) return 'anthropic'
  if (hasMistral) return 'mistral'
  if (hasAzure) return 'azure-openai'
  return 'openai'
}

/** Résout la clé Anthropic : BYOK utilisateur → var d'env instance */
async function resolveAnthropicKey(userId: string): Promise<string> {
  const user = await db
    .select({ anthropicApiKey: users.anthropicApiKey })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (user?.anthropicApiKey) {
    try {
      return decrypt(user.anthropicApiKey as Buffer)
    } catch { /* fall through */ }
  }

  if (config.ANTHROPIC_API_KEY) return config.ANTHROPIC_API_KEY

  throw new CopilotError(
    'Aucune clé API Anthropic configurée. Ajoutez ANTHROPIC_API_KEY dans les variables d\'environnement ou configurez votre clé personnelle.',
    'NO_API_KEY',
  )
}

export type FunctionInfo = { name: string; kind: string; return_type: string; arguments: string }
export type TabContext = { tabKind: 'query' | 'table' | 'function'; tabName: string; sql: string }

function resolveLocale(lang?: string): CopilotLocale {
  const key = (lang ?? 'en').slice(0, 2).toLowerCase()
  return key in copilotI18n ? (key as CopilotLocale) : 'en'
}

/**
 * Human-readable dialect announced to the model.
 * A lookup table, not a ternary chain: an unknown driver must never be announced
 * as "Oracle" (the model would then emit ROWNUM / DUAL / NVL / VARCHAR2).
 */
const DIALECT_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  oracle: 'Oracle',
  sqlite: 'SQLite',
  trino: 'Trino (SQL ANSI, moteur fédéré)',
}

type TrinoPromptStrings = {
  catalogLabel: string
  schemaLabel: string
  notSet: string
  /** Replaces the "you know the exact schema" claim when no catalog is pinned. */
  noCatalogNote: string
  rulesTitle: string
  rules: string[]
}

/**
 * Trino dialect rules injected into the system prompt.
 * Kept in this service (and not in copilot.i18n.ts) so that
 * `instructions(dialect)` keeps its current signature for every driver.
 */
const TRINO_PROMPT: Record<CopilotLocale, TrinoPromptStrings> = {
  fr: {
    catalogLabel: 'Catalogue',
    schemaLabel: 'Schéma',
    notSet: 'non fixé',
    noCatalogNote:
      "Aucun catalogue n'est sélectionné sur cette connexion : tu ne connais AUCUNE table. "
      + "N'invente jamais de nom de table ni de colonne. Demande d'abord à l'utilisateur de renseigner "
      + 'le catalogue dans la connexion, ou propose-lui `SHOW CATALOGS`, `SHOW SCHEMAS FROM <catalogue>` '
      + 'et `SHOW TABLES FROM <catalogue>.<schéma>` pour explorer.',
    rulesTitle: 'Spécificités Trino',
    rules: [
      "Trino est un moteur fédéré : une table se qualifie en `catalogue.schema.table`. Si le schéma n'est pas fixé ci-dessus, les noms du schéma sont déjà au format `schema.table` — préfixe-les du catalogue.",
      'Identifiants entre guillemets doubles ("ma_table"), en minuscules. Jamais de backticks ni de crochets.',
      'Pagination : `OFFSET n` se place AVANT `LIMIT n`. `LIMIT n OFFSET m` est une erreur de syntaxe.',
      "Pas de ROWNUM, pas de table DUAL, pas de NVL ni d'IFNULL : utilise `LIMIT`, `SELECT 1` sans FROM, et `COALESCE`.",
      "Pas d'ILIKE : utilise `lower(x) LIKE lower(y)`.",
      'Types : `VARCHAR` (non borné) plutôt que TEXT/CLOB/VARCHAR2, `TIMESTAMP(3)`, `DOUBLE`, `DECIMAL(p,s)`, `BOOLEAN`.',
      "Ni séquences, ni auto-increment, ni index, ni clés étrangères, ni procédures stockées, ni triggers : n'en propose jamais.",
      'Fonctions usuelles : `date_trunc`, `date_add`, `date_diff`, `from_unixtime`, `approx_distinct`, `array_agg`, `unnest`, `try_cast`, `cast(x AS type)`.',
      "Le DDL et les écritures (INSERT/UPDATE/DELETE/MERGE) dépendent du connecteur : précise-le quand tu en proposes.",
      'Une seule instruction SQL par requête, sans `;` final.',
    ],
  },
  en: {
    catalogLabel: 'Catalog',
    schemaLabel: 'Schema',
    notSet: 'not set',
    noCatalogNote:
      'No catalog is selected on this connection: you know NO tables at all. '
      + 'Never invent a table or column name. First ask the user to fill in the catalog on the '
      + 'connection, or offer `SHOW CATALOGS`, `SHOW SCHEMAS FROM <catalog>` and '
      + '`SHOW TABLES FROM <catalog>.<schema>` so they can explore.',
    rulesTitle: 'Trino specifics',
    rules: [
      'Trino is a federated engine: a table is qualified as `catalog.schema.table`. When no schema is pinned above, the schema names are already in `schema.table` form — prefix them with the catalog.',
      'Quote identifiers with double quotes ("my_table"), lowercase. Never backticks or brackets.',
      'Pagination: `OFFSET n` comes BEFORE `LIMIT n`. `LIMIT n OFFSET m` is a parse error.',
      'No ROWNUM, no DUAL table, no NVL or IFNULL: use `LIMIT`, `SELECT 1` without FROM, and `COALESCE`.',
      'No ILIKE: use `lower(x) LIKE lower(y)`.',
      'Types: `VARCHAR` (unbounded) instead of TEXT/CLOB/VARCHAR2, `TIMESTAMP(3)`, `DOUBLE`, `DECIMAL(p,s)`, `BOOLEAN`.',
      'No sequences, no auto-increment, no indexes, no foreign keys, no stored procedures, no triggers: never suggest any.',
      'Common functions: `date_trunc`, `date_add`, `date_diff`, `from_unixtime`, `approx_distinct`, `array_agg`, `unnest`, `try_cast`, `cast(x AS type)`.',
      'DDL and writes (INSERT/UPDATE/DELETE/MERGE) depend on the connector: say so when you suggest them.',
      'One single SQL statement per query, with no trailing `;`.',
    ],
  },
}

function buildSystemPrompt(
  schema: SchemaTable[],
  functions: FunctionInfo[],
  driver: string,
  database: string,
  lang?: string,
  context?: TabContext,
): string {
  const locale = resolveLocale(lang)
  const t = copilotI18n[locale]
  const dialect = DIALECT_LABELS[driver] ?? driver
  const isTrino = driver === 'trino'

  const tableDescriptions = schema.map((tbl) => {
    const cols = tbl.columns.map((c) => {
      const parts = [`  ${c.name} ${c.dataType}`]
      if (c.primaryKey) parts.push('PRIMARY KEY')
      if (!c.nullable) parts.push('NOT NULL')
      return parts.join(' ')
    }).join('\n')
    return `TABLE ${tbl.name} (\n${cols}\n)`
  }).join('\n\n')

  const funcDescriptions = functions.length > 0
    ? `\n\n## ${t.functionsLabel}\n` + functions.map((f) => {
        const kind = f.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
        const args = f.arguments ? `(${f.arguments})` : '()'
        const ret = f.kind !== 'procedure' && f.return_type ? ` RETURNS ${f.return_type}` : ''
        return `${kind} ${f.name}${args}${ret}`
      }).join('\n')
    : ''

  let contextSection = ''
  if (context) {
    if (context.tabKind === 'query' && context.sql.trim()) {
      contextSection = `\n\n## ${t.activeTabQuery}\n${t.activeTabQueryHint}\n\`\`\`sql\n${context.sql}\n\`\`\``
    } else if (context.tabKind === 'table') {
      contextSection = `\n\n## ${t.activeTabTable(context.tabName)}\n${t.activeTabTableHint(context.tabName)}`
    } else if (context.tabKind === 'function') {
      contextSection = `\n\n## ${t.activeTabFunction(context.tabName)}\n${t.activeTabFunctionHint}\n\`\`\`sql\n${context.sql}\n\`\`\``
    }
  }

  // Trino has no single "database": announce catalog and schema separately, otherwise
  // the model assumes one flat database and stops qualifying table names.
  const targetLines: string[] = []
  // A Trino connection with no catalog is a nominal state (the catalog switcher
  // lives there), but `fetchSchema` can then return nothing: never claim to know
  // the schema in that case, or the model invents table names with full confidence.
  let trinoWithoutCatalog = false
  if (isTrino) {
    const trino = TRINO_PROMPT[locale]
    const target = parseTrinoTarget(database)
    trinoWithoutCatalog = !target.catalog
    targetLines.push(`- ${trino.catalogLabel} : ${target.catalog ?? trino.notSet}`)
    targetLines.push(`- ${trino.schemaLabel} : ${target.schema ?? trino.notSet}`)
  } else {
    targetLines.push(`- ${t.dbLabel} : ${database}`)
  }

  const schemaKnowledgeLine = trinoWithoutCatalog
    ? TRINO_PROMPT[locale].noCatalogNote
    : t.schemaKnowledge

  const dialectSection = isTrino
    ? `\n\n## ${TRINO_PROMPT[locale].rulesTitle}\n` +
      TRINO_PROMPT[locale].rules.map((line) => `- ${line}`).join('\n')
    : ''

  const instructionLines = t.instructions(dialect).map((line) => `- ${line}`).join('\n')

  // An empty "## Schema" heading reads to the model as "this database has no
  // table". Trino-only: every other driver keeps its exact former prompt.
  const schemaSection = !isTrino || tableDescriptions
    ? `\n\n## ${t.schemaLabel}\n${tableDescriptions}`
    : ''

  return `${t.role}

## ${t.contextLabel}
${targetLines.join('\n')}
- ${t.driverLabel} : ${dialect}
- ${schemaKnowledgeLine}${schemaSection}${funcDescriptions}${contextSection}${dialectSection}

## Instructions
${instructionLines}`
}

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

type StreamChunk = { type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string }

async function* streamAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: CopilotMessage[],
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey })
  try {
    const stream = client.messages.stream({
      model: config.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text }
      }
    }
    yield { type: 'done' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur du copilot'
    if (msg.includes('401') || msg.includes('authentication')) {
      yield { type: 'error', message: 'Clé API invalide ou expirée.' }
    } else {
      yield { type: 'error', message: msg }
    }
  }
}

async function* streamOpenAIClient(
  client: OpenAI | AzureOpenAI,
  model: string,
  systemPrompt: string,
  messages: CopilotMessage[],
): AsyncGenerator<StreamChunk> {
  try {
    const stream = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    })
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? ''
      if (text) yield { type: 'text', text }
    }
    yield { type: 'done' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur du copilot'
    if (msg.includes('401') || msg.includes('authentication') || msg.includes('invalid_api_key')) {
      yield { type: 'error', message: 'Clé API invalide ou expirée.' }
    } else {
      yield { type: 'error', message: msg }
    }
  }
}

/** Stream une réponse copilot — dispatche vers le provider actif (déterminé par les vars d'env). */
export async function* streamCopilotResponse(
  userId: string,
  messages: CopilotMessage[],
  schema: SchemaTable[],
  functions: FunctionInfo[],
  driver: string,
  database: string,
  lang?: string,
  context?: TabContext,
): AsyncGenerator<StreamChunk> {
  const provider = getActiveProvider()
  const systemPrompt = buildSystemPrompt(schema, functions, driver, database, lang, context)

  if (provider === 'ollama') {
    const client = new OpenAI({
      baseURL: `${config.OLLAMA_BASE_URL}/v1`,
      apiKey: 'ollama',
    })
    const model = config.OLLAMA_MODEL ?? 'llama3.2'
    yield* streamOpenAIClient(client, model, systemPrompt, messages)
    return
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY! })
    const model = config.OPENAI_MODEL ?? 'gpt-4o'
    yield* streamOpenAIClient(client, model, systemPrompt, messages)
    return
  }

  if (provider === 'azure-openai') {
    const client = new AzureOpenAI({
      apiKey: config.AZURE_OPENAI_API_KEY!,
      endpoint: config.AZURE_OPENAI_ENDPOINT!,
      deployment: config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
      apiVersion: '2024-08-01-preview',
    })
    const model = config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o'
    yield* streamOpenAIClient(client, model, systemPrompt, messages)
    return
  }

  // Mistral exposes an OpenAI-compatible chat completions API: reuse the openai SDK.
  if (provider === 'mistral') {
    const client = new OpenAI({
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: config.MISTRAL_API_KEY!,
    })
    const model = config.MISTRAL_MODEL ?? 'mistral-large-latest'
    yield* streamOpenAIClient(client, model, systemPrompt, messages)
    return
  }

  // anthropic (default) — avec BYOK utilisateur
  const apiKey = await resolveAnthropicKey(userId)
  yield* streamAnthropic(apiKey, systemPrompt, messages)
}

// ── Column mapping (non-streaming) ────────────

export type ColumnMapping = {
  sourceColumn: string
  targetColumn: string | null
}

export async function mapColumnsWithAI(
  userId: string,
  sourceColumns: string[],
  targetColumns: Array<{ name: string; dataType: string }>,
): Promise<ColumnMapping[]> {
  const provider = getActiveProvider()

  const systemPrompt = `You are a data mapping assistant. Given source columns from an imported file and target columns from a database table, match each source column to the best target column based on name similarity and semantics.

Rules:
- Return ONLY a JSON array, no explanation, no markdown fences.
- Each element: {"sourceColumn": "...", "targetColumn": "..." or null}
- Every source column must appear exactly once.
- targetColumn is null if no reasonable match exists.
- A target column can be matched at most once.
- Be smart about abbreviations, casing, underscores vs camelCase, and translations (e.g. "nom" → "name", "prenom" → "first_name").`

  const userMessage = `Source columns: ${JSON.stringify(sourceColumns)}

Target columns: ${JSON.stringify(targetColumns.map((c) => ({ name: c.name, type: c.dataType })))}`

  const messages = [{ role: 'user' as const, content: userMessage }]

  let responseText = ''

  if (provider === 'ollama') {
    const client = new OpenAI({
      baseURL: `${config.OLLAMA_BASE_URL}/v1`,
      apiKey: 'ollama',
    })
    const model = config.OLLAMA_MODEL ?? 'llama3.2'
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    })
    responseText = res.choices[0]?.message?.content ?? '[]'
  } else if (provider === 'openai') {
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY! })
    const model = config.OPENAI_MODEL ?? 'gpt-4o'
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    })
    responseText = res.choices[0]?.message?.content ?? '[]'
  } else if (provider === 'azure-openai') {
    const client = new AzureOpenAI({
      apiKey: config.AZURE_OPENAI_API_KEY!,
      endpoint: config.AZURE_OPENAI_ENDPOINT!,
      deployment: config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o',
      apiVersion: '2024-08-01-preview',
    })
    const model = config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o'
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    })
    responseText = res.choices[0]?.message?.content ?? '[]'
  } else if (provider === 'mistral') {
    // Mistral exposes an OpenAI-compatible chat completions API: reuse the openai SDK.
    const client = new OpenAI({
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: config.MISTRAL_API_KEY!,
    })
    const model = config.MISTRAL_MODEL ?? 'mistral-large-latest'
    const res = await client.chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    })
    responseText = res.choices[0]?.message?.content ?? '[]'
  } else {
    const apiKey = await resolveAnthropicKey(userId)
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: config.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    })
    responseText = res.content[0]?.type === 'text' ? res.content[0].text : '[]'
  }

  // Parse — strip markdown fences if present
  const cleaned = responseText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  return JSON.parse(cleaned) as ColumnMapping[]
}
