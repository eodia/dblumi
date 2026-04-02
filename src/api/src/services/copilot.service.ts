import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { AzureOpenAI } from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { decrypt } from '../lib/crypto.js'

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
export function getActiveProvider(): 'anthropic' | 'openai' | 'azure-openai' {
  const hasOpenai = !!config.OPENAI_API_KEY
  const hasAzure = !!(config.AZURE_OPENAI_API_KEY && config.AZURE_OPENAI_ENDPOINT)
  const hasAnthropic = !!(config.ANTHROPIC_API_KEY)

  const count = [hasOpenai, hasAzure, hasAnthropic].filter(Boolean).length
  if (count > 1) {
    logger.warn('Multiple AI providers configured. Priority: openai > azure-openai > anthropic.')
  }

  if (hasOpenai) return 'openai'
  if (hasAzure) return 'azure-openai'
  return 'anthropic'
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

function buildSystemPrompt(
  schema: SchemaTable[],
  functions: FunctionInfo[],
  driver: string,
  database: string,
  context?: TabContext,
): string {
  const dialect = driver === 'postgresql' ? 'PostgreSQL' : driver === 'mysql' ? 'MySQL' : 'Oracle'

  const tableDescriptions = schema.map((t) => {
    const cols = t.columns.map((c) => {
      const parts = [`  ${c.name} ${c.dataType}`]
      if (c.primaryKey) parts.push('PRIMARY KEY')
      if (!c.nullable) parts.push('NOT NULL')
      return parts.join(' ')
    }).join('\n')
    return `TABLE ${t.name} (\n${cols}\n)`
  }).join('\n\n')

  const funcDescriptions = functions.length > 0
    ? '\n\n## Fonctions & Procédures\n' + functions.map((f) => {
        const kind = f.kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
        const args = f.arguments ? `(${f.arguments})` : '()'
        const ret = f.kind !== 'procedure' && f.return_type ? ` RETURNS ${f.return_type}` : ''
        return `${kind} ${f.name}${args}${ret}`
      }).join('\n')
    : ''

  let contextSection = ''
  if (context) {
    if (context.tabKind === 'query' && context.sql.trim()) {
      contextSection = `\n\n## Onglet actif — Requête SQL\nL'utilisateur travaille sur cette requête :\n\`\`\`sql\n${context.sql}\n\`\`\``
    } else if (context.tabKind === 'table') {
      contextSection = `\n\n## Onglet actif — Table "${context.tabName}"\nL'utilisateur explore la table \`${context.tabName}\`.`
    } else if (context.tabKind === 'function') {
      contextSection = `\n\n## Onglet actif — Fonction "${context.tabName}"\nL'utilisateur consulte cette fonction/procédure :\n\`\`\`sql\n${context.sql}\n\`\`\``
    }
  }

  return `Tu es le copilot SQL de dblumi, un assistant expert en bases de données.

## Contexte
- Base de données : ${database}
- Driver : ${dialect}
- Tu connais le schéma exact de cette base de données, y compris ses fonctions et procédures stockées.

## Schéma
${tableDescriptions}${funcDescriptions}${contextSection}

## Instructions
- Quand l'utilisateur demande une requête, génère du SQL valide pour ${dialect}.
- Utilise les noms exacts des tables, colonnes et fonctions du schéma ci-dessus.
- Entoure le SQL dans un bloc \`\`\`sql ... \`\`\` pour qu'il soit facilement identifiable.
- Si l'utilisateur pose une question sur l'onglet actif (requête, table ou fonction), réponds dans ce contexte.
- Si l'utilisateur demande une explication, explique de manière concise.
- Si la requête est ambiguë, demande des précisions plutôt que de deviner.
- Privilégie les requêtes performantes (index, LIMIT, etc.).
- Ne génère JAMAIS de requêtes destructives (DROP, TRUNCATE, DELETE sans WHERE) sauf demande explicite.
- Sois concis. Pas de préambule inutile.`
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
  context?: TabContext,
): AsyncGenerator<StreamChunk> {
  const provider = getActiveProvider()
  const systemPrompt = buildSystemPrompt(schema, functions, driver, database, context)

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

  // anthropic (default) — avec BYOK utilisateur
  const apiKey = await resolveAnthropicKey(userId)
  yield* streamAnthropic(apiKey, systemPrompt, messages)
}
