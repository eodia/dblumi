import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { getPoolOptions } from '../services/connection.service.js'
import { connectionManager } from '../lib/connection-manager.js'
import { executeImport } from '../services/data-import.service.js'
import { mapColumnsWithAI } from '../services/copilot.service.js'
import { logger } from '../logger.js'
import type { AuthVariables } from '../middleware/auth.js'

const dataImportRouter = new Hono<AuthVariables>()
dataImportRouter.use('*', authMiddleware)

const ImportColumnSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['text', 'varchar', 'integer', 'bigint', 'decimal', 'boolean', 'date', 'timestamp', 'float']),
})

const ImportSchema = z.object({
  connectionId: z.string().uuid(),
  tableName: z.string().min(1).max(200),
  createTable: z.boolean(),
  ifExists: z.enum(['error', 'append', 'replace']).default('error'),
  columns: z.array(ImportColumnSchema).min(1).max(500),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(100_000),
})

dataImportRouter.post(
  '/',
  zValidator('json', ImportSchema),
  async (c) => {
    const { connectionId, tableName, createTable, ifExists, columns, rows } = c.req.valid('json')
    const userId = c.get('userId')

    let poolOpts
    try {
      poolOpts = await getPoolOptions(connectionId, userId)
    } catch {
      return c.json(
        { type: 'error', message: 'Connexion introuvable ou non autorisée.' },
        404,
      )
    }

    const pool = await connectionManager.getPool(connectionId, poolOpts)

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      try {
        await executeImport(
          pool,
          poolOpts.driver,
          { tableName, createTable, ifExists, columns, rows },
          async (progress) => {
            await send('progress', progress)
          },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({ connectionId, tableName, err }, 'Data import error')
        await send('error', { message })
      }
    })
  },
)

const MapColumnsSchema = z.object({
  sourceColumns: z.array(z.string()).min(1).max(500),
  targetColumns: z.array(z.object({
    name: z.string(),
    dataType: z.string(),
  })).min(1).max(500),
})

dataImportRouter.post(
  '/map-columns',
  zValidator('json', MapColumnsSchema),
  async (c) => {
    const userId = c.get('userId')
    const { sourceColumns, targetColumns } = c.req.valid('json')

    try {
      const mapping = await mapColumnsWithAI(userId, sourceColumns, targetColumns)
      return c.json({ mapping })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err }, 'Column mapping AI error')
      return c.json({ type: 'error', message }, 500)
    }
  },
)

export { dataImportRouter }
