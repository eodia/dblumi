import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { executeSync } from '../services/data-sync.service.js'
import { DRIVER_LABELS, DRIVER_SUPPORT } from '../lib/drivers.js'
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

    // Refuse before opening any pool: executeSync() silently falls back to its
    // Oracle branches for unknown drivers, on both the source and target sides.
    const refused = [sourceOpts.driver, targetOpts.driver].find((d) => !DRIVER_SUPPORT[d].sync)
    if (refused) {
      return c.json({ type: 'error', message: `Synchronisation non supportée pour ${DRIVER_LABELS[refused]}.` }, 400)
    }
    // Same connection on both sides: the target table is dropped before the
    // source is read, so the data would simply be lost.
    if (sourceConnectionId === targetConnectionId && tables.some((t) => t.source === t.target)) {
      return c.json({ type: 'error', message: 'La source et la cible désignent la même table.' }, 400)
    }

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        const sourcePool = await connectionManager.getPool(sourceConnectionId, sourceOpts)
        const targetPool = await connectionManager.getPool(targetConnectionId, targetOpts)
        await executeSync(
          sourcePool as Parameters<typeof executeSync>[0], sourceOpts.driver as Parameters<typeof executeSync>[1],
          targetPool as Parameters<typeof executeSync>[2], targetOpts.driver as Parameters<typeof executeSync>[3],
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
