# Multi-Provider AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à chaque utilisateur de choisir son provider IA (Anthropic Claude, OpenAI, Azure OpenAI) avec sa propre clé API, configuré depuis un panneau dans le Copilot.

**Architecture:** Les préférences AI sont stockées par utilisateur dans la DB SQLite (provider + clés chiffrées AES-256-GCM). Un nouveau route `GET/PUT /api/v1/settings/copilot` gère la lecture/écriture. Le service `copilot.service.ts` dispatche vers le bon SDK (Anthropic existant ou `openai` qui couvre OpenAI + Azure). Le CopilotPanel gagne un gear icon ouvrant un panneau de settings inline.

**Tech Stack:** Drizzle ORM SQLite, Hono, `openai` npm package (SDK officiel OpenAI/Azure), `@anthropic-ai/sdk` (existant), React + TanStack Query, AES-256-GCM (crypto.ts existant)

---

## File Map

**New files:**
- `src/api/migrations/0007_ai_provider.sql` — migration SQLite : 6 nouvelles colonnes users
- `src/api/src/routes/settings.ts` — `GET /api/v1/settings/copilot` + `PUT /api/v1/settings/copilot`
- `src/web/src/api/settings.ts` — client frontend pour les settings copilot
- `src/web/src/components/copilot/CopilotSettings.tsx` — UI de configuration provider/clé

**Modified files:**
- `src/api/src/db/schema.ts` — ajouter 6 colonnes à `users`
- `src/api/migrations/meta/_journal.json` — ajouter entrée migration 0007
- `src/api/src/config.ts` — variables env optionnelles OpenAI/Azure fallback
- `src/api/src/services/copilot.service.ts` — multi-provider streaming
- `src/api/src/app.ts` — enregistrer settingsRouter
- `src/web/src/components/copilot/CopilotPanel.tsx` — gear icon + subtitle dynamique
- `src/web/src/i18n/en.ts` + `fr.ts` — nouvelles clés settings

---

## Task 1: DB migration — colonnes AI provider

**Files:**
- Modify: `src/api/src/db/schema.ts`
- Create: `src/api/migrations/0007_ai_provider.sql`
- Modify: `src/api/migrations/meta/_journal.json`

- [ ] **Étape 1 : Ajouter les colonnes dans schema.ts**

Dans `src/api/src/db/schema.ts`, ajouter après `anthropicApiKey: blob('anthropic_api_key')` :

```typescript
  aiProvider: text('ai_provider', { enum: ['anthropic', 'openai', 'azure-openai'] }).default('anthropic'),
  openaiApiKey: blob('openai_api_key'),                        // encrypted AES-256
  openaiModel: text('openai_model').default('gpt-4o'),
  azureOpenaiApiKey: blob('azure_openai_api_key'),             // encrypted AES-256
  azureOpenaiEndpoint: text('azure_openai_endpoint'),
  azureOpenaiDeployment: text('azure_openai_deployment').default('gpt-4o'),
```

- [ ] **Étape 2 : Créer le fichier de migration SQL**

Créer `src/api/migrations/0007_ai_provider.sql` :

```sql
ALTER TABLE `users` ADD `ai_provider` text DEFAULT 'anthropic';
--> statement-breakpoint
ALTER TABLE `users` ADD `openai_api_key` blob;
--> statement-breakpoint
ALTER TABLE `users` ADD `openai_model` text DEFAULT 'gpt-4o';
--> statement-breakpoint
ALTER TABLE `users` ADD `azure_openai_api_key` blob;
--> statement-breakpoint
ALTER TABLE `users` ADD `azure_openai_endpoint` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `azure_openai_deployment` text DEFAULT 'gpt-4o';
```

- [ ] **Étape 3 : Mettre à jour le journal des migrations**

Dans `src/api/migrations/meta/_journal.json`, ajouter à la fin du tableau `"entries"` :

```json
,{
  "idx": 7,
  "version": "6",
  "when": 1743724800000,
  "tag": "0007_ai_provider",
  "breakpoints": true
}
```

- [ ] **Étape 4 : Vérifier le typecheck backend**

```bash
cd c:/data/dev/dblumi/src/api && pnpm typecheck
```

Attendu : 0 erreur.

- [ ] **Étape 5 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/api/src/db/schema.ts src/api/migrations/0007_ai_provider.sql src/api/migrations/meta/_journal.json
git commit -m "feat: add AI provider columns to users table (migration 0007)"
```

---

## Task 2: Backend config + route settings

**Files:**
- Modify: `src/api/src/config.ts`
- Create: `src/api/src/routes/settings.ts`
- Modify: `src/api/src/app.ts`

- [ ] **Étape 1 : Ajouter les variables env optionnelles dans config.ts**

Dans `src/api/src/config.ts`, ajouter après `ANTHROPIC_API_KEY: z.string().optional()` :

```typescript
  OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
```

- [ ] **Étape 2 : Créer `src/api/src/routes/settings.ts`**

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '../lib/crypto.js'
import type { AuthVariables } from '../middleware/auth.js'

const settingsRouter = new Hono<AuthVariables>()
settingsRouter.use('*', authMiddleware)

const UpdateCopilotSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'azure-openai']),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().optional(),
  azureOpenaiApiKey: z.string().optional(),
  azureOpenaiEndpoint: z.string().optional(),
  azureOpenaiDeployment: z.string().optional(),
})

settingsRouter.get('/copilot', async (c) => {
  const userId = c.get('userId')
  const user = await db
    .select({
      aiProvider: users.aiProvider,
      anthropicApiKey: users.anthropicApiKey,
      openaiApiKey: users.openaiApiKey,
      openaiModel: users.openaiModel,
      azureOpenaiApiKey: users.azureOpenaiApiKey,
      azureOpenaiEndpoint: users.azureOpenaiEndpoint,
      azureOpenaiDeployment: users.azureOpenaiDeployment,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!user) return c.json({ error: 'User not found' }, 404)

  return c.json({
    provider: user.aiProvider ?? 'anthropic',
    hasAnthropicKey: !!user.anthropicApiKey,
    hasOpenaiKey: !!user.openaiApiKey,
    openaiModel: user.openaiModel ?? 'gpt-4o',
    hasAzureKey: !!user.azureOpenaiApiKey,
    azureOpenaiEndpoint: user.azureOpenaiEndpoint ?? '',
    azureOpenaiDeployment: user.azureOpenaiDeployment ?? 'gpt-4o',
  })
})

settingsRouter.put('/copilot', zValidator('json', UpdateCopilotSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')

  const patch: Partial<typeof users.$inferInsert> = {
    aiProvider: body.provider,
    updatedAt: new Date().toISOString(),
  }

  if (body.openaiModel) patch.openaiModel = body.openaiModel
  if (body.azureOpenaiEndpoint !== undefined) patch.azureOpenaiEndpoint = body.azureOpenaiEndpoint
  if (body.azureOpenaiDeployment) patch.azureOpenaiDeployment = body.azureOpenaiDeployment

  // Encrypt keys only if provided (non-empty string = update, empty = clear)
  if (body.anthropicApiKey !== undefined) {
    patch.anthropicApiKey = body.anthropicApiKey ? encrypt(body.anthropicApiKey) : null
  }
  if (body.openaiApiKey !== undefined) {
    patch.openaiApiKey = body.openaiApiKey ? encrypt(body.openaiApiKey) : null
  }
  if (body.azureOpenaiApiKey !== undefined) {
    patch.azureOpenaiApiKey = body.azureOpenaiApiKey ? encrypt(body.azureOpenaiApiKey) : null
  }

  await db.update(users).set(patch).where(eq(users.id, userId))

  return c.json({ ok: true })
})

export { settingsRouter }
```

- [ ] **Étape 3 : Enregistrer le router dans app.ts**

Dans `src/api/src/app.ts`, ajouter l'import et la route.

Trouver les imports des routes existants et ajouter :
```typescript
import { settingsRouter } from './routes/settings.js'
```

Trouver `app.route('/api/v1/sharing', sharingRouter)` et ajouter après :
```typescript
app.route('/api/v1/settings', settingsRouter)
```

- [ ] **Étape 4 : Vérifier le typecheck**

```bash
cd c:/data/dev/dblumi/src/api && pnpm typecheck
```

Attendu : 0 erreur.

- [ ] **Étape 5 : Vérifier que `encrypt` existe dans crypto.ts**

```bash
grep -n "export function encrypt" c:/data/dev/dblumi/src/api/src/lib/crypto.ts
```

Si `encrypt` n'existe pas (seulement `decrypt`), lire `c:\data\dev\dblumi\src\api\src\lib\crypto.ts` et ajouter la fonction `encrypt` symétrique à `decrypt` :

```typescript
export function encrypt(plaintext: string): Buffer {
  const key = Buffer.from(config.DBLUMI_ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}
```

- [ ] **Étape 6 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/api/src/config.ts src/api/src/routes/settings.ts src/api/src/app.ts src/api/src/lib/crypto.ts
git commit -m "feat: add settings route for copilot provider configuration"
```

---

## Task 3: Multi-provider copilot service

**Files:**
- Modify: `src/api/src/services/copilot.service.ts`

- [ ] **Étape 1 : Installer le package openai**

```bash
cd c:/data/dev/dblumi && pnpm add openai --filter @dblumi/api
```

Attendu : `openai` ajouté dans `src/api/package.json`.

- [ ] **Étape 2 : Réécrire copilot.service.ts**

Remplacer le contenu entier de `src/api/src/services/copilot.service.ts` par :

```typescript
import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { AzureOpenAI } from 'openai'
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

type ProviderConfig =
  | { provider: 'anthropic'; apiKey: string }
  | { provider: 'openai'; apiKey: string; model: string }
  | { provider: 'azure-openai'; apiKey: string; endpoint: string; deployment: string }

async function resolveProvider(userId: string): Promise<ProviderConfig> {
  const user = await db
    .select({
      aiProvider: users.aiProvider,
      anthropicApiKey: users.anthropicApiKey,
      openaiApiKey: users.openaiApiKey,
      openaiModel: users.openaiModel,
      azureOpenaiApiKey: users.azureOpenaiApiKey,
      azureOpenaiEndpoint: users.azureOpenaiEndpoint,
      azureOpenaiDeployment: users.azureOpenaiDeployment,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  const provider = user?.aiProvider ?? 'anthropic'

  if (provider === 'openai') {
    let apiKey: string | null = null
    if (user?.openaiApiKey) {
      try { apiKey = decrypt(user.openaiApiKey as Buffer) } catch { /* fall through */ }
    }
    if (!apiKey && config.OPENAI_API_KEY) apiKey = config.OPENAI_API_KEY
    if (!apiKey) throw new CopilotError('Aucune clé API OpenAI configurée.', 'NO_API_KEY')
    return { provider: 'openai', apiKey, model: user?.openaiModel ?? 'gpt-4o' }
  }

  if (provider === 'azure-openai') {
    let apiKey: string | null = null
    if (user?.azureOpenaiApiKey) {
      try { apiKey = decrypt(user.azureOpenaiApiKey as Buffer) } catch { /* fall through */ }
    }
    if (!apiKey && config.AZURE_OPENAI_API_KEY) apiKey = config.AZURE_OPENAI_API_KEY
    if (!apiKey) throw new CopilotError('Aucune clé API Azure OpenAI configurée.', 'NO_API_KEY')
    const endpoint = user?.azureOpenaiEndpoint ?? config.AZURE_OPENAI_ENDPOINT ?? ''
    const deployment = user?.azureOpenaiDeployment ?? config.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o'
    if (!endpoint) throw new CopilotError('Endpoint Azure OpenAI manquant.', 'NO_API_KEY')
    return { provider: 'azure-openai', apiKey, endpoint, deployment }
  }

  // anthropic (default)
  let apiKey: string | null = null
  if (user?.anthropicApiKey) {
    try { apiKey = decrypt(user.anthropicApiKey as Buffer) } catch { /* fall through */ }
  }
  if (!apiKey && config.ANTHROPIC_API_KEY) apiKey = config.ANTHROPIC_API_KEY
  if (!apiKey) throw new CopilotError(
    'Aucune clé API Anthropic configurée. Ajoutez ANTHROPIC_API_KEY dans les variables d\'environnement ou configurez votre clé personnelle.',
    'NO_API_KEY',
  )
  return { provider: 'anthropic', apiKey }
}

export type FunctionInfo = { name: string; kind: string; return_type: string; arguments: string }
export type TabContext = { tabKind: 'query' | 'table' | 'function'; tabName: string; sql: string }

/** Build the system prompt with schema, functions, and active tab context */
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
      model: 'claude-sonnet-4-20250514',
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

async function* streamOpenAI(
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

/** Stream a copilot response — dispatches to the correct provider */
export async function* streamCopilotResponse(
  userId: string,
  messages: CopilotMessage[],
  schema: SchemaTable[],
  functions: FunctionInfo[],
  driver: string,
  database: string,
  context?: TabContext,
): AsyncGenerator<StreamChunk> {
  const providerConfig = await resolveProvider(userId)
  const systemPrompt = buildSystemPrompt(schema, functions, driver, database, context)

  if (providerConfig.provider === 'anthropic') {
    yield* streamAnthropic(providerConfig.apiKey, systemPrompt, messages)
  } else if (providerConfig.provider === 'openai') {
    const client = new OpenAI({ apiKey: providerConfig.apiKey })
    yield* streamOpenAI(client, providerConfig.model, systemPrompt, messages)
  } else {
    const client = new AzureOpenAI({
      apiKey: providerConfig.apiKey,
      endpoint: providerConfig.endpoint,
      deployment: providerConfig.deployment,
      apiVersion: '2024-08-01-preview',
    })
    yield* streamOpenAI(client, providerConfig.deployment, systemPrompt, messages)
  }
}
```

- [ ] **Étape 3 : Vérifier typecheck**

```bash
cd c:/data/dev/dblumi/src/api && pnpm typecheck
```

Attendu : 0 erreur.

- [ ] **Étape 4 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/api/src/services/copilot.service.ts src/api/package.json
git commit -m "feat: multi-provider copilot (OpenAI + Azure OpenAI)"
```

---

## Task 4: Frontend — API settings + i18n

**Files:**
- Create: `src/web/src/api/settings.ts`
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`

- [ ] **Étape 1 : Créer `src/web/src/api/settings.ts`**

```typescript
import { api } from './client'

export type AiProvider = 'anthropic' | 'openai' | 'azure-openai'

export type CopilotSettings = {
  provider: AiProvider
  hasAnthropicKey: boolean
  hasOpenaiKey: boolean
  openaiModel: string
  hasAzureKey: boolean
  azureOpenaiEndpoint: string
  azureOpenaiDeployment: string
}

export type UpdateCopilotSettings = {
  provider: AiProvider
  anthropicApiKey?: string
  openaiApiKey?: string
  openaiModel?: string
  azureOpenaiApiKey?: string
  azureOpenaiEndpoint?: string
  azureOpenaiDeployment?: string
}

export const settingsApi = {
  getCopilot: () => api.get<CopilotSettings>('/settings/copilot'),
  updateCopilot: (data: UpdateCopilotSettings) => api.put<{ ok: boolean }>('/settings/copilot', data),
}
```

- [ ] **Étape 2 : Ajouter les clés i18n dans en.ts**

Trouver la section `// ── Copilot ──` et ajouter après les clés existantes :

```typescript
  'copilot.settings': 'AI Settings',
  'copilot.provider': 'Provider',
  'copilot.providerAnthropic': 'Anthropic (Claude)',
  'copilot.providerOpenai': 'OpenAI',
  'copilot.providerAzure': 'Azure OpenAI',
  'copilot.apiKey': 'API Key',
  'copilot.apiKeyPlaceholder': 'sk-…',
  'copilot.apiKeySet': 'Key saved — enter a new value to update',
  'copilot.model': 'Model',
  'copilot.azureEndpoint': 'Azure Endpoint',
  'copilot.azureEndpointPlaceholder': 'https://my-resource.openai.azure.com',
  'copilot.azureDeployment': 'Deployment name',
  'copilot.save': 'Save',
  'copilot.saved': 'Settings saved',
  'copilot.subtitleOpenai': 'OpenAI',
  'copilot.subtitleAzure': 'Azure OpenAI',
```

- [ ] **Étape 3 : Ajouter les clés i18n dans fr.ts**

Même emplacement, en français :

```typescript
  'copilot.settings': 'Paramètres IA',
  'copilot.provider': 'Fournisseur',
  'copilot.providerAnthropic': 'Anthropic (Claude)',
  'copilot.providerOpenai': 'OpenAI',
  'copilot.providerAzure': 'Azure OpenAI',
  'copilot.apiKey': 'Clé API',
  'copilot.apiKeyPlaceholder': 'sk-…',
  'copilot.apiKeySet': 'Clé enregistrée — saisir une nouvelle valeur pour modifier',
  'copilot.model': 'Modèle',
  'copilot.azureEndpoint': 'Endpoint Azure',
  'copilot.azureEndpointPlaceholder': 'https://ma-ressource.openai.azure.com',
  'copilot.azureDeployment': 'Nom du déploiement',
  'copilot.save': 'Enregistrer',
  'copilot.saved': 'Paramètres enregistrés',
  'copilot.subtitleOpenai': 'OpenAI',
  'copilot.subtitleAzure': 'Azure OpenAI',
```

- [ ] **Étape 4 : Typecheck**

```bash
cd c:/data/dev/dblumi/src/web && pnpm typecheck 2>&1 | grep "settings.ts" | head -10
```

Attendu : 0 erreur.

- [ ] **Étape 5 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/web/src/api/settings.ts src/web/src/i18n/en.ts src/web/src/i18n/fr.ts
git commit -m "feat: add settings API client and i18n keys for multi-provider copilot"
```

---

## Task 5: Frontend — CopilotSettings + CopilotPanel

**Files:**
- Create: `src/web/src/components/copilot/CopilotSettings.tsx`
- Modify: `src/web/src/components/copilot/CopilotPanel.tsx`

- [ ] **Étape 1 : Lire CopilotPanel.tsx**

Lire `c:\data\dev\dblumi\src\web\src\components\copilot\CopilotPanel.tsx` pour trouver :
- La structure du header (où est `copilot.title` + `copilot.subtitle`)
- Les imports existants
- La zone de contenu principal

- [ ] **Étape 2 : Créer `CopilotSettings.tsx`**

Créer `c:\data\dev\dblumi\src\web\src\components\copilot\CopilotSettings.tsx` :

```typescript
// src/web/src/components/copilot/CopilotSettings.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi, type AiProvider } from '@/api/settings'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = { onClose: () => void }

export function CopilotSettings({ onClose }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['copilot-settings'],
    queryFn: settingsApi.getCopilot,
    staleTime: 60_000,
  })

  const [provider, setProvider] = useState<AiProvider>(settings?.provider ?? 'anthropic')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState(settings?.openaiModel ?? 'gpt-4o')
  const [azureKey, setAzureKey] = useState('')
  const [azureEndpoint, setAzureEndpoint] = useState(settings?.azureOpenaiEndpoint ?? '')
  const [azureDeployment, setAzureDeployment] = useState(settings?.azureOpenaiDeployment ?? 'gpt-4o')

  // Sync defaults when settings load
  if (settings && provider !== settings.provider && anthropicKey === '' && openaiKey === '' && azureKey === '') {
    setProvider(settings.provider)
    setOpenaiModel(settings.openaiModel)
    setAzureEndpoint(settings.azureOpenaiEndpoint)
    setAzureDeployment(settings.azureOpenaiDeployment)
  }

  const mutation = useMutation({
    mutationFn: settingsApi.updateCopilot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['copilot-settings'] })
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    },
  })

  const handleSave = () => {
    mutation.mutate({
      provider,
      ...(anthropicKey && { anthropicApiKey: anthropicKey }),
      ...(openaiKey && { openaiApiKey: openaiKey }),
      openaiModel,
      ...(azureKey && { azureOpenaiApiKey: azureKey }),
      azureOpenaiEndpoint: azureEndpoint,
      azureOpenaiDeployment: azureDeployment,
    })
  }

  const providers: { value: AiProvider; label: string }[] = [
    { value: 'anthropic', label: t('copilot.providerAnthropic') },
    { value: 'openai', label: t('copilot.providerOpenai') },
    { value: 'azure-openai', label: t('copilot.providerAzure') },
  ]

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <div className="space-y-1.5">
        <Label className="text-xs">{t('copilot.provider')}</Label>
        <div className="flex gap-1.5">
          {providers.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setProvider(p.value)}
              className={cn(
                'flex-1 rounded px-2 py-1.5 text-xs border transition-colors',
                provider === p.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-surface-raised',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {provider === 'anthropic' && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('copilot.apiKey')}</Label>
          {settings?.hasAnthropicKey && !anthropicKey && (
            <p className="text-[10px] text-muted-foreground">{t('copilot.apiKeySet')}</p>
          )}
          <Input
            type="password"
            placeholder={settings?.hasAnthropicKey ? '••••••••' : t('copilot.apiKeyPlaceholder')}
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      )}

      {provider === 'openai' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('copilot.apiKey')}</Label>
            {settings?.hasOpenaiKey && !openaiKey && (
              <p className="text-[10px] text-muted-foreground">{t('copilot.apiKeySet')}</p>
            )}
            <Input
              type="password"
              placeholder={settings?.hasOpenaiKey ? '••••••••' : t('copilot.apiKeyPlaceholder')}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('copilot.model')}</Label>
            <Input
              placeholder="gpt-4o"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        </>
      )}

      {provider === 'azure-openai' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('copilot.apiKey')}</Label>
            {settings?.hasAzureKey && !azureKey && (
              <p className="text-[10px] text-muted-foreground">{t('copilot.apiKeySet')}</p>
            )}
            <Input
              type="password"
              placeholder={settings?.hasAzureKey ? '••••••••' : t('copilot.apiKeyPlaceholder')}
              value={azureKey}
              onChange={(e) => setAzureKey(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('copilot.azureEndpoint')}</Label>
            <Input
              placeholder={t('copilot.azureEndpointPlaceholder')}
              value={azureEndpoint}
              onChange={(e) => setAzureEndpoint(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('copilot.azureDeployment')}</Label>
            <Input
              placeholder="gpt-4o"
              value={azureDeployment}
              onChange={(e) => setAzureDeployment(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        </>
      )}

      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={handleSave}
        disabled={mutation.isPending || saved}
      >
        {saved
          ? <><Check className="h-3 w-3" />{t('copilot.saved')}</>
          : t('copilot.save')
        }
      </Button>
    </div>
  )
}
```

- [ ] **Étape 3 : Modifier CopilotPanel.tsx**

Lire le fichier, puis appliquer les 3 changements suivants :

**3a — Ajouter les imports** (en haut, après les imports existants) :
```typescript
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { Settings } from 'lucide-react'
import { CopilotSettings } from './CopilotSettings'
```

**3b — Ajouter l'état `showSettings` et la query dans le composant `CopilotPanel`** (après les états existants) :
```typescript
const [showSettings, setShowSettings] = useState(false)
const { data: copilotSettings } = useQuery({
  queryKey: ['copilot-settings'],
  queryFn: settingsApi.getCopilot,
  staleTime: 60_000,
})
```

**3c — Dans le header du panel, remplacer le `<span>` du subtitle et ajouter le gear icon** :

Trouver le rendu du titre/subtitle dans le header (lignes avec `copilot.title` et `copilot.subtitle`). Remplacer la zone subtitle + ajouter gear :

```typescript
{/* Dans le header, remplacer 'copilot.subtitle' par : */}
<span className="text-[10px] text-text-muted">
  {copilotSettings?.provider === 'openai'
    ? t('copilot.subtitleOpenai')
    : copilotSettings?.provider === 'azure-openai'
    ? t('copilot.subtitleAzure')
    : t('copilot.subtitle')}
</span>
{/* Juste avant le bouton onClose, ajouter : */}
<Button
  variant="ghost"
  size="sm"
  className="h-6 w-6 p-0"
  onClick={() => setShowSettings((v) => !v)}
  title={t('copilot.settings')}
>
  <Settings className="h-3.5 w-3.5" />
</Button>
```

**3d — Afficher le panneau settings** :

Trouver la zone principale du panel (après le header, avant la liste de messages). Ajouter en haut de la zone scrollable :

```typescript
{showSettings && (
  <CopilotSettings onClose={() => setShowSettings(false)} />
)}
```

- [ ] **Étape 4 : Typecheck**

```bash
cd c:/data/dev/dblumi/src/web && pnpm typecheck 2>&1 | grep "error TS" | head -20
```

Attendu : 0 nouvelle erreur.

- [ ] **Étape 5 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/web/src/components/copilot/CopilotSettings.tsx src/web/src/components/copilot/CopilotPanel.tsx
git commit -m "feat: add CopilotSettings UI with provider/key configuration"
```

---

## Self-Review

**Spec coverage :**
- ✅ Claude (Anthropic) — déjà géré, conservé dans `streamAnthropic`
- ✅ OpenAI — `streamOpenAI` avec `new OpenAI({ apiKey })`
- ✅ Azure OpenAI — `streamOpenAI` avec `new AzureOpenAI({ endpoint, deployment, apiKey })`
- ✅ Clé API par provider stockée chiffrée par utilisateur
- ✅ Fallback vers variables d'environnement instance-level
- ✅ Sélecteur provider dans le UI (CopilotSettings)
- ✅ Subtitle dynamique dans CopilotPanel selon provider actif
- ✅ i18n EN + FR

**Placeholder scan :** aucun TBD, aucun "similar to Task N", code complet dans chaque étape.

**Type consistency :**
- `AiProvider = 'anthropic' | 'openai' | 'azure-openai'` défini dans `settings.ts` (Task 4), utilisé dans `CopilotSettings.tsx` (Task 5) ✅
- `ProviderConfig` union défini dans `copilot.service.ts` (Task 3), utilisé en interne ✅
- `CopilotSettings` type de réponse GET correspond aux champs retournés par la route ✅
