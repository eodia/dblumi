# Multi-Provider AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supporter Claude, OpenAI et Azure OpenAI dans le copilot, le provider actif étant déterminé uniquement par les variables d'environnement (aucun choix utilisateur).

**Architecture:** Le service `copilot.service.ts` détecte le provider actif à partir des vars d'env : `OPENAI_API_KEY` → OpenAI, `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` → Azure OpenAI, sinon → Anthropic (comportement existant inchangé). Le package `openai` (SDK officiel) gère OpenAI et Azure. Un endpoint léger `GET /api/v1/settings/copilot-info` expose le provider actif au frontend pour le subtitle du CopilotPanel.

**Tech Stack:** `openai` npm package, `@anthropic-ai/sdk` (existant), Hono, React + TanStack Query

---

## File Map

**No DB changes** — aucune migration nécessaire.

**Modified files:**
- `src/api/src/config.ts` — ajouter vars env optionnelles OpenAI/Azure
- `src/api/src/services/copilot.service.ts` — détection provider + streaming multi-provider
- `src/api/src/routes/settings.ts` (NEW) — `GET /settings/copilot-info`
- `src/api/src/app.ts` — enregistrer settingsRouter
- `src/web/src/api/settings.ts` (NEW) — client frontend
- `src/web/src/components/copilot/CopilotPanel.tsx` — subtitle dynamique
- `src/web/src/i18n/en.ts` + `fr.ts` — nouvelles clés subtitle

---

## Task 1: Config + service multi-provider

**Files:**
- Modify: `src/api/src/config.ts`
- Modify: `src/api/src/services/copilot.service.ts`

- [ ] **Étape 1 : Installer le package openai**

```bash
cd c:/data/dev/dblumi && pnpm add openai --filter @dblumi/api
```

Attendu : `openai` dans `src/api/package.json`.

- [ ] **Étape 2 : Ajouter les variables env dans config.ts**

Dans `src/api/src/config.ts`, ajouter après `ANTHROPIC_API_KEY: z.string().optional()` :

```typescript
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
```

- [ ] **Étape 3 : Réécrire copilot.service.ts**

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

/** Détecte le provider actif depuis les variables d'environnement. */
export function getActiveProvider(): 'anthropic' | 'openai' | 'azure-openai' {
  if (config.OPENAI_API_KEY) return 'openai'
  if (config.AZURE_OPENAI_API_KEY && config.AZURE_OPENAI_ENDPOINT) return 'azure-openai'
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
  context?: TabContext,
): AsyncGenerator<StreamChunk> {
  const provider = getActiveProvider()
  const systemPrompt = buildSystemPrompt(schema, functions, driver, database, context)

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
```

- [ ] **Étape 4 : Typecheck**

```bash
cd c:/data/dev/dblumi/src/api && pnpm typecheck
```

Attendu : 0 erreur.

- [ ] **Étape 5 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/api/src/config.ts src/api/src/services/copilot.service.ts src/api/package.json
git commit -m "feat: multi-provider copilot via env vars (OpenAI + Azure OpenAI)"
```

---

## Task 2: Endpoint info + frontend subtitle

**Files:**
- Create: `src/api/src/routes/settings.ts`
- Modify: `src/api/src/app.ts`
- Create: `src/web/src/api/settings.ts`
- Modify: `src/web/src/i18n/en.ts`
- Modify: `src/web/src/i18n/fr.ts`
- Modify: `src/web/src/components/copilot/CopilotPanel.tsx`

- [ ] **Étape 1 : Créer `src/api/src/routes/settings.ts`**

```typescript
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
    : 'claude-sonnet-4'
  return c.json({ provider, model })
})

export { settingsRouter }
```

- [ ] **Étape 2 : Enregistrer dans app.ts**

Dans `src/api/src/app.ts`, ajouter l'import :
```typescript
import { settingsRouter } from './routes/settings.js'
```

Ajouter après `app.route('/api/v1/sharing', sharingRouter)` :
```typescript
app.route('/api/v1/settings', settingsRouter)
```

- [ ] **Étape 3 : Créer `src/web/src/api/settings.ts`**

```typescript
import { api } from './client'

export type CopilotInfo = {
  provider: 'anthropic' | 'openai' | 'azure-openai'
  model: string
}

export const settingsApi = {
  getCopilotInfo: () => api.get<CopilotInfo>('/settings/copilot-info'),
}
```

- [ ] **Étape 4 : Ajouter clés i18n dans en.ts**

Trouver la section `// ── Copilot ──` et ajouter après `'copilot.errorContact'` :

```typescript
  'copilot.subtitleOpenai': 'OpenAI',
  'copilot.subtitleAzure': 'Azure OpenAI',
```

- [ ] **Étape 5 : Ajouter clés i18n dans fr.ts**

Même emplacement :

```typescript
  'copilot.subtitleOpenai': 'OpenAI',
  'copilot.subtitleAzure': 'Azure OpenAI',
```

- [ ] **Étape 6 : Modifier CopilotPanel.tsx — subtitle dynamique**

Lire `c:\data\dev\dblumi\src\web\src\components\copilot\CopilotPanel.tsx`.

Ajouter l'import en haut (si `useQuery` n'est pas déjà importé) :
```typescript
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
```

Dans le corps de `CopilotPanel`, ajouter après les états existants :
```typescript
const { data: copilotInfo } = useQuery({
  queryKey: ['copilot-info'],
  queryFn: settingsApi.getCopilotInfo,
  staleTime: Infinity,
})
```

Trouver la ligne qui rend `t('copilot.subtitle')` et la remplacer par :
```typescript
{copilotInfo?.provider === 'openai'
  ? t('copilot.subtitleOpenai')
  : copilotInfo?.provider === 'azure-openai'
  ? t('copilot.subtitleAzure')
  : t('copilot.subtitle')}
```

- [ ] **Étape 7 : Typecheck**

```bash
cd c:/data/dev/dblumi/src/web && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Attendu : 0 nouvelle erreur.

- [ ] **Étape 8 : Commit**

```bash
cd c:/data/dev/dblumi
git add src/api/src/routes/settings.ts src/api/src/app.ts src/web/src/api/settings.ts src/web/src/i18n/en.ts src/web/src/i18n/fr.ts src/web/src/components/copilot/CopilotPanel.tsx
git commit -m "feat: show active AI provider in copilot subtitle"
```

---

## Self-Review

**Spec coverage :**
- ✅ Claude (Anthropic) — conservé, avec BYOK utilisateur (`anthropicApiKey` DB) inchangé
- ✅ OpenAI — `OPENAI_API_KEY` dans env → `new OpenAI({ apiKey })`
- ✅ Azure OpenAI — `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` → `new AzureOpenAI(...)`
- ✅ Aucun choix utilisateur — tout déterminé par les vars d'env
- ✅ Subtitle CopilotPanel reflète le provider actif
- ✅ Aucune migration DB nécessaire

**Placeholder scan :** aucun TBD, code complet dans chaque étape.

**Type consistency :**
- `getActiveProvider()` retourne `'anthropic' | 'openai' | 'azure-openai'` dans le service (Task 1) et est réutilisé dans le route (Task 2) ✅
- `CopilotInfo.provider` type correspond à la valeur retournée par `getActiveProvider()` ✅
