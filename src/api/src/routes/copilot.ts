import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { streamCopilotResponse, CopilotError } from '../services/copilot.service.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { logger } from '../logger.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { fetchSchema, liveDatabaseOf, type DbSchema } from '../services/schema.service.js'
import { mongoDatabaseName } from '../lib/mongo.js'
import type { AuthVariables } from '../middleware/auth.js'

const copilotRouter = new Hono<AuthVariables>()
copilotRouter.use('*', authMiddleware)

const CopilotSchema = z.object({
  connectionId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
  })).min(1),
  context: z.object({
    tabKind: z.enum(['query', 'table', 'function']),
    tabName: z.string(),
    sql: z.string(),
  }).optional(),
})

// ── Route ──

copilotRouter.post(
  '/',
  zValidator('json', CopilotSchema),
  async (c) => {
    const { connectionId, messages, context } = c.req.valid('json')
    const userId = c.get('userId')

    // Resolve connection
    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Connexion introuvable.' }, 404)
    }

    // Fetch user language preference
    const userRow = await db
      .select({ language: users.language })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    const lang = userRow?.language ?? 'en'

    // Fetch schema + functions for context — the same introspection as the
    // schema browser, so every driver (SQLite and Oracle included) gets one.
    let schema: DbSchema['tables'] = []
    let functions: DbSchema['functions'] = []
    // Trino/MongoDB: `switch-database` re-targets the live client without
    // persisting it, so the connection manager holds the truth.
    const live = liveDatabaseOf(connectionId, poolOpts.database)
    const database = poolOpts.driver === 'mongodb' ? mongoDatabaseName(live) : live ?? ''
    try {
      const pool = await connectionManager.getPool(connectionId, poolOpts)
      const result = await fetchSchema(connectionId, poolOpts.driver, pool, poolOpts.database)
      schema = result.tables
      functions = result.functions
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch schema for copilot')
    }

    // Stream response
    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        for await (const chunk of streamCopilotResponse(
          userId,
          messages,
          schema,
          functions,
          poolOpts.driver,
          database,
          lang,
          context,
        )) {
          if (chunk.type === 'text') {
            await send('text', { text: chunk.text })
          } else if (chunk.type === 'done') {
            await send('done', {})
          } else if (chunk.type === 'error') {
            await send('error', { message: chunk.message })
          }
        }
      } catch (err) {
        if (err instanceof CopilotError) {
          await send('error', { message: err.message })
        } else {
          const msg = err instanceof Error ? err.message : 'Erreur interne du copilot'
          logger.error({ err }, 'Copilot stream error')
          await send('error', { message: msg })
        }
      }
    })
  },
)

export { copilotRouter }
