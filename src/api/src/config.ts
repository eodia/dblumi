import { z } from 'zod'

const ConfigSchema = z.object({
  DBLUMI_ENCRYPTION_KEY: z
    .string()
    .length(64, 'DBLUMI_ENCRYPTION_KEY must be 32 bytes (64 hex chars)'),
  DATABASE_PATH: z.string().default('./data/dblumi.db'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DBLUMI_TELEMETRY: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_CLIENT_ID: z.string().optional(),
  KEYCLOAK_CLIENT_SECRET: z.string().optional(),
})

const result = ConfigSchema.safeParse(process.env)

if (!result.success) {
  console.error('❌ Invalid environment configuration:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = result.data
