# CLAUDE.md — dblumi

Self-hosted open-source SQL client with AI copilot. AGPL-3.0. pnpm monorepo.

## Exact Stack

| Layer | Tech | Version | Notes |
|-------|------|---------|-------|
| Runtime | Node.js | >= 22 | pnpm 9.15.0 |
| Backend | Hono | 4.7.4 | NOT Express, NOT Fastify |
| ORM | Drizzle | 0.40.0 | SQLite/Turso, NOT Prisma |
| Auth | Jose | 5.10.0 | JWT, NOT jsonwebtoken |
| Passwords | @node-rs/argon2 | 2.0.2 | NOT bcrypt |
| Frontend | React | 19 | Client-side SPA, NOT Next.js, NO SSR |
| Bundler | Vite | 6.2.1 | NOT Webpack |
| CSS | Tailwind CSS | 4.0.12 | v4 syntax (@import "tailwindcss"), NO tailwind.config |
| Components | Radix UI + shadcn/ui | — | CVA + clsx + tailwind-merge |
| State | Zustand | 5.0.3 | One store per feature, NO global store |
| Data fetching | @tanstack/react-query | 5.69.0 | staleTime: 60_000, retry: 1 |
| Editor | CodeMirror | 6 | With lang-sql, merge, autocomplete |
| Collab | Yjs + y-websocket | 13.6.30 | Real-time CRDT |
| AI | @anthropic-ai/sdk | 0.80.0 | + openai 6.33.0 |
| Unit tests | Vitest | 3.0.8 | |
| E2E tests | Playwright | 1.58.2 | Chromium, auto-start servers |
| Docs site | Astro Starlight | 6.0.1 | In www/, uses npm (not pnpm) |

## Directory Structure

```
src/
├── api/                          # @dblumi/api — Hono backend
│   ├── src/
│   │   ├── routes/               # One file per resource (auth.ts, connections.ts…)
│   │   ├── services/             # Business logic (auth.service.ts, connection.service.ts…)
│   │   ├── middleware/           # auth.ts (JWT + roles)
│   │   ├── db/
│   │   │   ├── schema.ts        # ALL Drizzle tables in this single file
│   │   │   └── index.ts         # DB instance
│   │   └── lib/                  # Utilities (jwt.ts, crypto.ts, query-executor.ts)
│   ├── migrations/               # Generated Drizzle migrations
│   └── drizzle.config.ts
│
├── web/                          # @dblumi/web — React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/               # shadcn primitives (button.tsx, input.tsx, dialog.tsx…)
│   │   │   ├── editor/           # SQL editor, CodeMirror
│   │   │   ├── connections/      # Connection management
│   │   │   ├── saved-queries/    # Saved queries
│   │   │   ├── copilot/          # AI assistant
│   │   │   ├── schema/           # Schema browser, ERD
│   │   │   ├── layout/           # AppShell, Sidebar, Header
│   │   │   └── [feature]/        # One folder per feature
│   │   ├── api/                  # HTTP client (one file per resource)
│   │   ├── stores/               # Zustand stores (auth.store.ts, editor.store.ts)
│   │   ├── pages/                # LoginPage.tsx, RegisterPage.tsx
│   │   ├── styles/globals.css    # Tailwind v4 @theme + design tokens
│   │   └── i18n/                 # fr/en
│   └── vite.config.ts
│
├── shared/                       # @dblumi/shared — shared Zod types
│   └── src/types/                # auth, connection, query, schema, api
│
www/                              # Astro docs site (separate npm project)
e2e/                              # Playwright tests
```

## Naming Conventions

| What | Convention | Examples |
|------|-----------|----------|
| React components | PascalCase.tsx | `ActivityCard.tsx`, `SqlEditor.tsx` |
| UI primitives (shadcn) | lowercase.tsx | `button.tsx`, `input.tsx` |
| Feature folders | kebab-case | `saved-queries/`, `command-palette/` |
| Zustand stores | kebab-case.store.ts | `auth.store.ts`, `editor.store.ts` |
| Hooks | use-kebab-case.ts | `use-mobile.ts` |
| API routes (backend) | kebab-case.ts | `saved-queries.ts`, `db-users.ts` |
| Services | kebab-case.service.ts | `auth.service.ts` |
| Variables/functions | camelCase | `savedQueriesApi`, `createConnection` |
| Types/Interfaces | PascalCase | `AuthVariables`, `UserRole` |

## Required Patterns

### Frontend

- **Imports**: `@/` alias → `src/` (never deep relative `../../..`)
- **State**: one Zustand store per domain, never a monolithic global store
- **Data fetching**: React Query for all API calls. Never `useEffect` + `fetch`
- **API client**: use `src/web/src/api/client.ts` (`api.get<T>()`, `api.post<T>()`)
- **Routing**: manual via URLSearchParams in App.tsx (no react-router)
- **UI components**: Radix via shadcn/ui in `components/ui/`. CVA for variants
- **Tailwind**: pure utility-first, tokens via CSS variables in `@theme` in globals.css
- **Fonts**: Geist (sans), JetBrains Mono (mono)

### Backend

- **Routes**: `new Hono<AuthVariables>()` per file, export the router
- **Validation**: Zod schemas + `zValidator('json', Schema)` middleware
- **Auth**: `authMiddleware` on all protected routes, `c.get('userId')` for current user
- **Errors**: `HTTPException` or custom classes, Problem Details RFC 9457 response format
- **Imports**: relative paths with `.js` extension (NodeNext resolution)
- **Shared types**: `import type { X } from '@dblumi/shared'`

### Database

- **Schema**: everything in `src/api/src/db/schema.ts`, single file
- **Migrations**: generated by drizzle-kit, never hand-written
- **Encryption**: AES-256-GCM for stored credentials (connection passwords, API keys)

## Do NOT

- **No `@apply`** in CSS — utility classes only
- **No tailwind.config.js** — config lives in `globals.css` via `@theme`
- **No react-router** — routing is in App.tsx with URLSearchParams
- **No `useEffect` + `fetch`** — use React Query
- **No global Zustand store** — one store per feature
- **No barrel exports** (index.ts) — direct imports to the file
- **No deep relative imports** on web side — use `@/`
- **No `jsonwebtoken`** — use `jose`
- **No Prisma** — use Drizzle
- **No bcrypt** — use Argon2
- **No Express** — use Hono
- **No SSR/RSC** — this is a client-side SPA

## Reference Examples

### Typical React Component

```tsx
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { savedQueriesApi } from '@/api/saved-queries'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { Input } from '@/components/ui/input'

type Props = { connectionId: string; onNavigate: (page: string) => void }

export function ActivityCard({ connectionId, onNavigate }: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')

  const { data } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: savedQueriesApi.list,
    staleTime: 60_000,
  })

  const filtered = useMemo(
    () => (data?.savedQueries ?? []).filter(
      (q) => q.name.toLowerCase().includes(search.toLowerCase())
    ),
    [data, search],
  )

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} />
      {filtered.map((q) => (
        <button key={q.id} className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => onNavigate('editor')}>
          {q.name}
        </button>
      ))}
    </div>
  )
}
```

### Typical API Route

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { createConnection, ConnectionError } from '../services/connection.service.js'
import type { AuthVariables } from '../middleware/auth.js'

const router = new Hono<AuthVariables>()
router.use('*', authMiddleware)

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  driver: z.enum(['postgresql', 'mysql', 'oracle']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})

router.post('/', zValidator('json', CreateSchema), async (c) => {
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const conn = await createConnection(userId, body)
  return c.json(conn, 201)
})

export { router as connectionsRouter }
```

## Commands

```bash
pnpm dev                # API (3000) + Web (5173) concurrently
pnpm build              # Build shared → web → api
pnpm test               # Vitest across all packages
pnpm test:e2e           # Playwright (auto-start servers)
pnpm typecheck          # TSC across all packages
pnpm lint               # Lint all packages
```

## Commits

Quand tu commit, commit en tant que Marc JAMAIN

## Language

Respond in French. Code and commits in English.
