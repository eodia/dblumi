import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { AzureOpenAI } from 'openai'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { decrypt } from '../lib/crypto.js'
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

function resolveLocale(lang?: string): CopilotLocale {
  const key = (lang ?? 'en').slice(0, 2).toLowerCase()
  return key in copilotI18n ? (key as CopilotLocale) : 'en'
}

function buildSystemPrompt(
  schema: SchemaTable[],
  functions: FunctionInfo[],
  driver: string,
  database: string,
  lang?: string,
  context?: TabContext,
): string {
  const t = copilotI18n[resolveLocale(lang)]
  const dialect = driver === 'postgresql' ? 'PostgreSQL' : driver === 'mysql' ? 'MySQL' : 'Oracle'

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

  const instructionLines = t.instructions(dialect).map((line) => `- ${line}`).join('\n')

  return `${t.role}

## ${t.contextLabel}
- ${t.dbLabel} : ${database}
- ${t.driverLabel} : ${dialect}
- ${t.schemaKnowledge}

## ${t.schemaLabel}
${tableDescriptions}${funcDescriptions}${contextSection}

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
