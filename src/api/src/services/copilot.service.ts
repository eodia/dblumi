import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
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

/** Resolve the Anthropic API key: user BYOK → instance-level key */
async function resolveApiKey(userId: string): Promise<string> {
  // Check user-level BYOK key first
  const user = await db
    .select({ anthropicApiKey: users.anthropicApiKey })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (user?.anthropicApiKey) {
    try {
      return decrypt(user.anthropicApiKey as Buffer)
    } catch {
      // Decryption failed — fall through to instance key
    }
  }

  // Fall back to instance-level key
  if (config.ANTHROPIC_API_KEY) {
    return config.ANTHROPIC_API_KEY
  }

  throw new CopilotError(
    'Aucune clé API Anthropic configurée. Ajoutez ANTHROPIC_API_KEY dans les variables d\'environnement ou configurez votre clé personnelle.',
    'NO_API_KEY',
  )
}

/** Build the system prompt with schema context */
function buildSystemPrompt(schema: SchemaTable[], driver: string, database: string): string {
  const tableDescriptions = schema.map((t) => {
    const cols = t.columns.map((c) => {
      const parts = [`  ${c.name} ${c.dataType}`]
      if (c.primaryKey) parts.push('PRIMARY KEY')
      if (!c.nullable) parts.push('NOT NULL')
      return parts.join(' ')
    }).join('\n')
    return `TABLE ${t.name} (\n${cols}\n)`
  }).join('\n\n')

  return `Tu es le copilot SQL de dblumi, un assistant expert en bases de données.

## Contexte
- Base de données : ${database}
- Driver : ${driver}
- Tu connais le schéma exact de cette base de données.

## Schéma
${tableDescriptions}

## Instructions
- Quand l'utilisateur demande une requête, génère du SQL valide pour ${driver === 'postgresql' ? 'PostgreSQL' : 'MySQL'}.
- Utilise les noms exacts des tables et colonnes du schéma ci-dessus.
- Entoure le SQL dans un bloc \`\`\`sql ... \`\`\` pour qu'il soit facilement identifiable.
- Si l'utilisateur demande une explication, explique en français de manière concise.
- Si la requête est ambiguë, demande des précisions plutôt que de deviner.
- Privilégie les requêtes performantes (index, LIMIT, etc.).
- Ne génère JAMAIS de requêtes destructives (DROP, TRUNCATE, DELETE sans WHERE) sauf demande explicite.
- Sois concis. Pas de préambule inutile.`
}

export type CopilotMessage = { role: 'user' | 'assistant'; content: string }

/** Stream a copilot response */
export async function* streamCopilotResponse(
  userId: string,
  messages: CopilotMessage[],
  schema: SchemaTable[],
  driver: string,
  database: string,
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string }> {
  const apiKey = await resolveApiKey(userId)

  const client = new Anthropic({ apiKey })
  const systemPrompt = buildSystemPrompt(schema, driver, database)

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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

