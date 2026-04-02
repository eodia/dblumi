import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import { getActiveProvider } from '../services/copilot.service.js'
import { config } from '../config.js'
import type { AuthVariables } from '../middleware/auth.js'

const settingsRouter = new Hono<AuthVariables>()
settingsRouter.use('*', authMiddleware)

settingsRouter.get('/copilot-info', (c) => {
  const provider = getActiveProvider()
  const model = provider === 'openai'
    ? (config.OPENAI_MODEL ?? 'gpt-4o')
    : provider === 'azure-openai'
    ? (config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o')
    : (config.ANTHROPIC_MODEL ?? 'claude-sonnet-4')
  return c.json({ provider, model })
})

export { settingsRouter }
