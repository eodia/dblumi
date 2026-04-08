import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { executeSync } from '../services/data-sync.service.js'
import { logger } from '../logger.js'
import type { AuthVariables } from '../middleware/auth.js'

const dataSyncRouter = new Hono<AuthVariables>()
dataSyncRouter.use('*', authMiddleware)

const SyncSchema = z.object({
  sourceConnectionId: z.string().uuid(),
  targetConnectionId: z.string().uuid(),
  tables: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
  })).min(1).max(500),
  includeConstraints: z.boolean().default(false),
  includeData: z.boolean().default(true),
})

dataSyncRouter.post(
  '/',
  zValidator('json', SyncSchema),
  async (c) => {
    const { sourceConnectionId, targetConnectionId, tables, includeConstraints, includeData } = c.req.valid('json')
    const userId = c.get('userId')

    let sourceOpts
    let targetOpts
    try {
      sourceOpts = await getPoolOptions(sourceConnectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Source connection not found.' }, 404)
    }
    try {
      targetOpts = await getPoolOptions(targetConnectionId, userId)
    } catch {
      return c.json({ type: 'error', message: 'Target connection not found.' }, 404)
    }

    const sourcePool = await connectionManager.getPool(sourceConnectionId, sourceOpts)
    const targetPool = await connectionManager.getPool(targetConnectionId, targetOpts)

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        await executeSync(
          sourcePool, sourceOpts.driver,
          targetPool, targetOpts.driver,
          tables,
          { includeConstraints, includeData },
          async (progress) => { await send('progress', progress) },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({ sourceConnectionId, targetConnectionId, err }, 'Data sync error')
        await send('error', { message })
      }
    })
  },
)

export { dataSyncRouter }
