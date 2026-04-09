import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import { getActiveProvider } from '../services/copilot.service.js'
import { config } from '../config.js'
import { isSmtpConfigured } from '../lib/mailer.js'
import type { AuthVariables } from '../middleware/auth.js'

const settingsRouter = new Hono<AuthVariables>()

// Public — needed on login page to show OAuth buttons and forgot-password link
settingsRouter.get('/auth-providers', (c) => {
  return c.json({
    keycloak: !!(config.KEYCLOAK_ISSUER && config.KEYCLOAK_CLIENT_ID && config.KEYCLOAK_CLIENT_SECRET),
    github: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
    google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    smtpConfigured: isSmtpConfigured(),
  })
})

// Protected routes
settingsRouter.get('/copilot-info', authMiddleware, (c) => {
  const provider = getActiveProvider()
  const model = provider === 'ollama'
    ? (config.OLLAMA_MODEL ?? 'llama3.2')
    : provider === 'openai'
    ? (config.OPENAI_MODEL ?? 'gpt-4o')
    : provider === 'azure-openai'
    ? (config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o')
    : (config.ANTHROPIC_MODEL ?? 'claude-sonnet-4')
  return c.json({ provider, model })
})

export { settingsRouter }
