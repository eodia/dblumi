---
stepsCompleted:
  - step-01-init
  - step-02-context
  - step-03-starter
  - step-04-decisions
  - step-05-patterns
  - step-06-structure
  - step-07-validation
  - step-08-complete
lastStep: 8
status: 'complete'
completedAt: '2026-03-28'
inputDocuments:
  - prd.md
workflowType: 'architecture'
project_name: 'dblumi'
user_name: 'Marc'
date: '2026-03-28'
---

# Architecture Decision Document

_Ce document se construit de manière collaborative à travers une découverte étape par étape. Les sections sont ajoutées au fil des décisions architecturales prises ensemble._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
44 exigences sur 8 domaines : gestion des connexions DB (avec proxy backend obligatoire et chiffrement AES-256), exploration de schéma (< 2s pour 500 tables), éditeur SQL complet avec guardrails destructifs et streaming de résultats, copilote IA natif au schéma (NL→SQL, SQL→explication, streaming tokens, BYOK), bibliothèque de requêtes partagées, gestion d'équipe (SSO OAuth + RBAC 3 rôles), REST API documentée OpenAPI + serveur MCP, déploiement Docker one-liner avec i18n.

**Non-Functional Requirements:**
- Performance : < 3s chargement initial, < 2s schéma 500 tables, < 500ms premier résultat streaming, < 1s premier token IA, < 100ms actions UI locales
- Sécurité : AES-256 at rest, proxy backend (credentials jamais navigateur), JWT + révocation immédiate, images Docker signées cosign/sigstore, HTTPS délégué
- Accessibilité : WCAG 2.1 AA, navigation clavier complète, ARIA
- Compatibilité : Docker 20.10+, linux/amd64 + linux/arm64, navigateurs N/N-1

**Scale & Complexity:**
- Domaine principal : full-stack developer tool web
- Complexité : medium-high
- Composants architecturaux estimés : 8–12 (frontend SPA, backend API, proxy DB, couche chiffrement, gestionnaire d'auth, streaming SSE/WS, connecteurs DB, moteur copilote IA, serveur MCP, couche i18n, worker telemetry opt-in)

### Technical Constraints & Dependencies

- Single Docker container : SPA statique servie par le backend (pas de SSR Node.js)
- Backend proxy obligatoire : toute connexion DB passe par le serveur — contrainte de sécurité non négociable
- Clé de chiffrement `DBLUMI_ENCRYPTION_KEY` : fournie par l'opérateur via var env — dblumi ne la génère pas
- API Anthropic (Claude) : requise pour le copilote ; BYOK par utilisateur + clé partagée par instance
- OAuth providers : GitHub et Google pour SSO
- Images multi-arch : linux/amd64 + linux/arm64

### Cross-Cutting Concerns Identified

- **Auth & Authorization** : sessions JWT, RBAC 3 rôles, groupes, SSO OAuth, déprovisionnement immédiat — traverse toutes les couches
- **Encryption at rest** : AES-256 sur les credentials DB, cycle de vie de la clé
- **Backend proxy pattern** : architecture serveur pour toutes les requêtes DB
- **Streaming** : SSE ou WebSocket pour résultats de requêtes et tokens IA
- **i18n** : infrastructure de traduction externalisée traversant tout le frontend
- **Docker single-container** : pipeline build frontend → assets statiques → backend

---

## Starter Template Evaluation

### Primary Technology Domain

Full-stack developer tool — SPA statique + backend API, déploiement Docker single-container.

### Starter Options Considered

| Option | Décision | Raison |
|---|---|---|
| **Hono + React Vite** | ✅ Retenu | `@hono/mcp` officiel, SSE natif, serve static, TypeScript first |
| **Fastify + React Vite** | ❌ Écarté | Plugin MCP tiers (fastify-mcp), moins actif |
| **Turborepo monorepo** | ❌ Écarté | Complexité superflue pour solo dev MVP |
| **Go + React Vite** | ❌ Écarté | SDK MCP officiel TypeScript uniquement |

### Selected Stack

**Backend :** Hono (TypeScript) + Node.js 22 LTS
**Frontend :** React 19 + Vite 8 (TypeScript strict)

**Initialisation du projet :**

```bash
mkdir dblumi && cd dblumi
npm create hono@latest .   # base backend Hono
# puis setup Vite React dans src/web/
pnpm create vite src/web --template react-ts
```

### Structure du Repo

```
dblumi/
  src/
    web/        ← Vite React SPA (build → src/api/public/)
    api/        ← Hono TypeScript (API + MCP + serve static)
    shared/     ← types + utilitaires communs (ConnectionManager, etc.)
  docker/
  Dockerfile
```

### Décisions Architecturales du Starter

**Langage & Runtime :**
TypeScript strict, Node.js 22 LTS, ESM modules

**Frontend :**

| Librairie | Version | Rôle |
|---|---|---|
| React | 19.x | UI framework |
| Vite | 8.x | Build tool + HMR dev |
| shadcn/ui | latest | Composants UI (Radix UI + Tailwind) |
| Tailwind CSS | v4 | Styling utility-first + dark mode |
| CodeMirror 6 | latest | Éditeur SQL (coloration, autocomplétion) |
| TanStack Query | v5 | Server state, fetching, cache |
| TanStack Router | v1 | Routing typé, file-based |
| TanStack Virtual | v3 | Virtualisation grandes tables de résultats |

**Composants shadcn/ui clés pour dblumi :**
- `<Table>` + TanStack Virtual — résultats de requêtes (grands datasets)
- `<Command>` — palette de commandes, recherche dans le schéma
- `<ResizablePanelGroup>` — layout éditeur / résultats / schéma
- `<Sheet>` — drawer copilote IA
- Dark mode natif — essentiel pour un outil développeur

**Backend :**

| Librairie | Version | Rôle |
|---|---|---|
| Hono | 4.12.x | API framework + SSE + serve static |
| @hono/mcp | latest | Serveur MCP officiel |
| Drizzle ORM | latest | ORM interne (SQLite en dev/prod solo) |
| better-sqlite3 | latest | Driver SQLite (stockage interne dblumi) |
| pg | latest | Driver PostgreSQL (DB utilisateurs) |
| mysql2 | latest | Driver MySQL (DB utilisateurs) |

**Stockage interne (dblumi) :**
SQLite via Drizzle ORM — zéro dépendance externe, fichier dans volume Docker,
backup = copie du fichier. Migration vers PostgreSQL prévue en Phase 2 (Drizzle supporte les deux).

**Drivers DB utilisateurs :**
`pg` + `mysql2` avec `ConnectionManager` custom dans `src/shared/` — pool par connexion, pas global.

**Testing :**
Vitest — unifié frontend/backend, compatible Vite ecosystem

**Development :**
`concurrently` — frontend HMR + backend watch en parallèle, proxy Vite → Hono en dev

**Note :** L'initialisation du projet avec cette structure sera la première story d'implémentation.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Décisions critiques (bloquantes pour l'implémentation) :**
- Validation unifiée → Zod (frontend + backend)
- Auth JWT → jose
- OAuth → Arctic (GitHub + Google)
- Streaming → SSE via Hono `streamSSE()`
- État UI → Zustand

**Décisions importantes (structurent l'architecture) :**
- Hachage → argon2 (@node-rs/argon2)
- Chiffrement → Node.js crypto built-in (AES-256)
- Logging → pino + hono-pino
- i18n → react-i18next
- Migrations DB → drizzle-kit

**Décisions différées (post-MVP) :**
- Stockage interne : migration SQLite → PostgreSQL si Phase 2 cloud (Drizzle supporte les deux)
- Rate limiting API (explicitement hors scope MVP)
- Cache Redis (non requis en MVP single-container)

---

### Data Architecture

| Décision | Choix | Rationale |
|---|---|---|
| Validation schéma | **Zod** | Un seul schéma partagé frontend/backend, `@hono/zod-validator` intégré |
| ORM interne | **Drizzle ORM** + drizzle-kit | SQLite en MVP, migration PostgreSQL sans changement de code en Phase 2 |
| Migrations | **drizzle-kit** | Génération automatique des migrations SQLite |
| Hachage mots de passe | **argon2** (@node-rs/argon2) | OWASP recommandé, native bindings performants |
| Chiffrement AES-256 | **Node.js crypto** built-in | Zéro dépendance, `DBLUMI_ENCRYPTION_KEY` via env var |
| Drivers DB utilisateurs | **pg** + **mysql2** | Drivers natifs, ConnectionManager custom dans `src/shared/` |
| Stockage interne | **SQLite** (fichier dans volume Docker) | Zéro dépendance externe, backup trivial |

**ConnectionManager (`src/shared/connection-manager.ts`) :**
Pool de connexions par connexion DB utilisateur (pas un pool global). Chaque connexion active maintient son propre `pg.Pool` ou `mysql2.Pool`. Nettoyage à la déconnexion.

---

### Authentication & Security

| Décision | Choix | Rationale |
|---|---|---|
| JWT | **jose** | Web Standards API, edge-compatible, maintenu (panva) |
| OAuth | **Arctic** | Légère, TypeScript first, GitHub + Google natifs, parfaite pour Hono |
| Sessions | JWT httpOnly cookie + Authorization header (API) | Cookie pour UI, header Bearer pour REST API + MCP |
| Révocation | Blacklist JWT en SQLite (table `revoked_tokens`) | Simple, efficace pour déprovisionnement immédiat |
| Credentials DB | AES-256-GCM (Node.js crypto) | IV aléatoire par credential, tag d'authentification |
| Transport | HTTPS délégué au reverse proxy opérateur | Nginx, Caddy, Traefik — hors scope dblumi |

---

### API & Communication Patterns

| Décision | Choix | Rationale |
|---|---|---|
| Versioning | `/api/v1/...` | Simple, standard REST |
| Format d'erreur | RFC 7807 Problem Details | `{ type, title, status, detail }` — standard HTTP |
| Validation routes | `@hono/zod-validator` | Zod schemas, types inférés, erreurs 400 automatiques |
| Streaming | **SSE** via `streamSSE()` Hono | Query results + tokens IA — WebSocket écarté (complexité inutile) |
| Documentation API | **OpenAPI** via `@hono/swagger-ui` + `@hono/zod-openapi` | Généré depuis les schemas Zod |
| MCP Server | **@hono/mcp** | Officiel, maintenu, 4 outils : `get_schema`, `execute_query`, `list_connections`, `get_saved_queries` |
| Rate limiting | **Aucun en MVP** | Décision PRD explicite |

---

### Frontend Architecture

| Décision | Choix | Rationale |
|---|---|---|
| Server state | **TanStack Query v5** | Fetching, cache, invalidation, background refetch |
| Client state | **Zustand** | État UI partagé (connexion active, onglets SQL, état copilote), 1 KB |
| Routing | **TanStack Router v1** | Type-safe, file-based, compatible avec l'approche SPA |
| i18n | **react-i18next** | Standard de facto, lazy loading fichiers de traduction, Vite compatible |
| Virtualisation | **TanStack Virtual v3** | Résultats de requêtes grands datasets (> 1000 lignes) |
| Formulaires | **React Hook Form** + Zod resolver | Validation côté client avec les mêmes schemas Zod |
| Composants | **shadcn/ui** (Radix UI + Tailwind v4) | Accessibilité WCAG AA intégrée, dark mode natif |
| Éditeur SQL | **CodeMirror 6** | Coloration SQL, autocomplétion schéma, vim mode opt-in |

---

### Infrastructure & Deployment

| Décision | Choix | Rationale |
|---|---|---|
| Docker build | Multi-stage (build → node:22-alpine) | Image finale ~150 MB, zéro dépendances dev |
| Registry | **ghcr.io** (GitHub Container Registry) | Gratuit, intégré GitHub Actions |
| Multi-arch | `docker buildx` linux/amd64 + linux/arm64 | Apple Silicon + serveurs x86 |
| Image signing | **cosign/sigstore** | Intégrité des releases, per PRD |
| CI/CD | **GitHub Actions** | Build + test + push ghcr.io + cosign signing |
| Logging | **pino** + `hono-pino` | JSON structuré, ultra rapide, niveau configurable via env |
| Config validation | **Zod** au démarrage | L'app refuse de démarrer si `DBLUMI_ENCRYPTION_KEY` ou `DATABASE_PATH` manque |
| Telemetry | **Opt-in uniquement** | Désactivé par défaut, `DBLUMI_TELEMETRY=true` pour activer |

**Variables d'environnement obligatoires :**
```
DBLUMI_ENCRYPTION_KEY   # Clé AES-256 (32 bytes hex) — fournie par l'opérateur
DATABASE_PATH           # Chemin SQLite (défaut: /data/dblumi.db)
JWT_SECRET              # Secret JWT (min 32 chars)
BASE_URL                # URL publique de l'instance
```

**Variables optionnelles :**
```
ANTHROPIC_API_KEY       # Clé Claude partagée (BYOK si absent)
GITHUB_CLIENT_ID/SECRET # OAuth GitHub
GOOGLE_CLIENT_ID/SECRET # OAuth Google
PORT                    # Défaut: 3000
DBLUMI_TELEMETRY        # Défaut: false
LOG_LEVEL               # Défaut: info
```

### Decision Impact Analysis

**Séquence d'implémentation recommandée :**
1. Setup repo + Docker + CI/CD + validation env vars
2. SQLite schema + Drizzle migrations (users, connections, groups, saved_queries)
3. Auth (local + JWT + OAuth Arctic)
4. Connection Manager + chiffrement AES-256
5. Proxy DB + connecteurs pg/mysql2
6. API REST + OpenAPI
7. Frontend SPA base + shadcn/ui + routing
8. Éditeur SQL + CodeMirror 6 + streaming SSE
9. Copilote IA + streaming tokens
10. Bibliothèque de requêtes
11. Admin UI + RBAC
12. MCP Server
13. i18n + instance démo

**Dépendances inter-composants :**
- Auth → tout le reste (middleware JWT traverse toutes les routes)
- Connection Manager → Proxy DB, Éditeur SQL, Copilote IA, MCP Server
- Zod schemas (`src/shared/`) → validation API ET formulaires frontend
- Drizzle schema → migrations → Connection Manager → API

---

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Base de données (Drizzle schema) :**
- Tables : `snake_case` pluriel → `users`, `connections`, `groups`, `saved_queries`, `group_members`, `revoked_tokens`
- Colonnes : `snake_case` → `created_at`, `user_id`, `connection_string`
- Clés étrangères : `{table_singular}_id` → `user_id`, `group_id`
- Index : `idx_{table}_{column(s)}` → `idx_users_email`

**API endpoints :**
- `kebab-case` pluriel → `/api/v1/connections`, `/api/v1/saved-queries`, `/api/v1/groups`
- Paramètres de route : `:id` (pas `{id}`)
- Query params : `camelCase` → `?connectionId=`, `?pageSize=`

**JSON (API ↔ Frontend) :**
- `camelCase` → `userId`, `createdAt`, `connectionString`
- Dates : ISO 8601 → `"2026-03-28T10:00:00Z"` (jamais de timestamp Unix)

**Code TypeScript :**
- Variables/fonctions : `camelCase` → `getUserById`, `connectionManager`
- Types/Interfaces/Classes : `PascalCase` → `UserConnection`, `SavedQuery`
- Constantes : `SCREAMING_SNAKE_CASE` → `MAX_CONNECTIONS`, `JWT_EXPIRY`
- Fichiers backend : `kebab-case` → `connection-manager.ts`, `user-router.ts`
- Fichiers frontend composants : `PascalCase` → `ConnectionCard.tsx`, `SchemaTree.tsx`
- Hooks React : `camelCase` préfixe `use` → `useConnections.ts`, `useSchemaTree.ts`

### Structure Patterns

**Tests :** Co-localisés avec le fichier source → `connection-manager.test.ts` à côté de `connection-manager.ts` (pas de dossier `__tests__` séparé)

**Routes Hono :** Un fichier par domaine dans `src/api/routes/` → `connections.ts`, `users.ts`, `schema.ts`, `queries.ts`. Chaque fichier exporte un router Hono monté dans `src/api/app.ts`.

**Composants React :** Organisation par feature → `src/web/features/editor/`, `src/web/features/schema/`, `src/web/features/copilot/`. Composants partagés → `src/web/components/ui/` (shadcn/ui) + `src/web/components/shared/`.

**Zod schemas :** Définis dans `src/shared/schemas/` → `user.schema.ts`, `connection.schema.ts`. Réutilisés côté backend (validation Hono) ET frontend (React Hook Form).

### Format Patterns

**Réponse API — succès :**
```typescript
// Liste
{ data: T[], total: number, page: number, limit: number }
// Item unique
{ data: T }
// Action sans retour (DELETE, etc.)
// 204 No Content
```

**Réponse API — erreur (RFC 7807) :**
```typescript
{
  type: "https://dblumi.dev/errors/not-found",
  title: "Resource Not Found",
  status: 404,
  detail: "Connection with id 'abc' not found"
}
```

**Codes HTTP standard :**
`200` GET/PUT · `201` POST créé · `204` DELETE · `400` validation · `401` non auth · `403` interdit · `404` introuvable · `422` erreur métier · `500` serveur

### State Management Patterns

**Règle fondamentale : deux stores, deux responsabilités — jamais mélangés**

- **TanStack Query** → toute donnée serveur (connexions, schéma, résultats, bibliothèque)
- **Zustand** → état UI pur (connexion active, onglets SQL, état copilote, préférences)

```typescript
// ✅ Correct
const { data: connections } = useQuery({ queryKey: ['connections'], queryFn: fetchConnections })
const activeConnectionId = useAppStore(s => s.activeConnectionId)

// ❌ Interdit
useAppStore.setState({ connections: [...] }) // données serveur dans Zustand
```

### Error Handling Patterns

**Backend :**
- Middleware Hono centralisé → formate toutes les erreurs en RFC 7807
- Jamais de stack trace exposée au client
- `logger.error(...)` (pino) avec contexte structuré — jamais `console.log`

**Frontend :**
- Erreurs fatales → React Error Boundary au niveau route
- Erreurs de fetching → TanStack Query `error` state + toast
- Erreurs de formulaire → React Hook Form `formState.errors` inline
- Messages utilisateur → toujours actionnables ("La connexion a échoué — vérifiez les credentials")

### All AI Agents MUST

1. Nommer les tables DB en `snake_case` pluriel, colonnes en `snake_case`
2. Retourner `{ data: T }` ou `{ data: T[], total, page, limit }` pour les succès API
3. Retourner RFC 7807 pour toutes les erreurs API
4. Utiliser TanStack Query pour les données serveur, Zustand pour l'état UI — jamais l'inverse
5. Placer les tests co-localisés (`*.test.ts`) — jamais dans un dossier `__tests__`
6. Définir les Zod schemas dans `src/shared/schemas/` — réutilisés frontend ET backend
7. Utiliser `logger` (pino) côté backend — jamais `console.log`
8. Dater en ISO 8601 dans l'API — jamais de timestamp Unix
9. Nommer les fichiers backend en `kebab-case`, composants React en `PascalCase`
10. Router les requêtes destructives DB via `src/api/services/guardrails.ts`

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
dblumi/
├── .github/
│   └── workflows/
│       ├── ci.yml                      # Build + test + lint
│       └── release.yml                 # Build Docker + push ghcr.io + cosign
├── docker/
│   └── docker-compose.yml
├── src/
│   ├── api/                            # Backend Hono
│   │   ├── index.ts                    # Entry point Node.js
│   │   ├── app.ts                      # Hono app + mount routes + middleware
│   │   ├── config.ts                   # Zod env vars validation (fail-fast au démarrage)
│   │   ├── db/
│   │   │   ├── schema.ts               # Drizzle schema (users, connections, groups,
│   │   │   │                           #   group_members, saved_queries, revoked_tokens)
│   │   │   ├── client.ts               # SQLite client init + Drizzle instance
│   │   │   └── migrations/             # drizzle-kit generated
│   │   ├── routes/
│   │   │   ├── auth.ts                 # POST /api/v1/auth/login|register|logout
│   │   │   │                           # GET  /api/v1/auth/oauth/:provider
│   │   │   ├── connections.ts          # CRUD /api/v1/connections (FR01-07)
│   │   │   ├── schema.ts               # GET  /api/v1/connections/:id/schema (FR08-11)
│   │   │   ├── query.ts                # POST /api/v1/connections/:id/query (FR12-18, SSE)
│   │   │   ├── ai.ts                   # POST /api/v1/ai/complete (FR19-25, SSE)
│   │   │   ├── saved-queries.ts        # CRUD /api/v1/saved-queries (FR26-31)
│   │   │   ├── users.ts                # CRUD /api/v1/users (FR32-37)
│   │   │   ├── groups.ts               # CRUD /api/v1/groups (FR34-35)
│   │   │   └── admin.ts                # GET  /api/v1/admin/dashboard (FR41)
│   │   ├── services/
│   │   │   ├── auth.ts                 # JWT (jose), OAuth (Arctic), sessions, révocation
│   │   │   ├── connection-manager.ts   # Pool par connexion DB (pg.Pool / mysql2.Pool)
│   │   │   ├── encryption.ts           # AES-256-GCM via Node.js crypto
│   │   │   ├── schema-inspector.ts     # Introspection PostgreSQL + MySQL
│   │   │   ├── query-executor.ts       # Exécution SQL + streaming SSE progressif
│   │   │   ├── guardrails.ts           # Détection destructive + estimation lignes (FR15-16)
│   │   │   ├── copilot.ts              # Claude API, NL→SQL, SQL→explain, BYOK, streaming
│   │   │   └── telemetry.ts            # Opt-in telemetry (FR44)
│   │   ├── middleware/
│   │   │   ├── auth.ts                 # JWT validation + inject user dans context
│   │   │   ├── rbac.ts                 # Vérification rôle admin/éditeur/lecteur
│   │   │   └── error-handler.ts        # RFC 7807 global error formatter
│   │   └── mcp/
│   │       └── server.ts               # @hono/mcp: get_schema, execute_query,
│   │                                   #   list_connections, get_saved_queries (FR39)
│   ├── web/                            # Frontend React Vite
│   │   ├── index.html
│   │   ├── vite.config.ts              # Proxy /api → backend en dev, build → src/api/public/
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── main.tsx                # Entry point React
│   │       ├── router.tsx              # TanStack Router (routes typées)
│   │       ├── store.ts                # Zustand (connexion active, onglets SQL, état copilote)
│   │       ├── api/
│   │       │   └── client.ts           # Fetch client typé
│   │       ├── components/
│   │       │   ├── ui/                 # shadcn/ui (Button, Table, Sheet, Command, etc.)
│   │       │   └── shared/             # ErrorBoundary, Layout, Sidebar, Toast
│   │       ├── features/
│   │       │   ├── auth/               # LoginPage, RegisterPage, OAuthCallback
│   │       │   ├── connections/        # ConnectionList, ConnectionForm, ConnectionCard
│   │       │   ├── schema/             # SchemaTree, TableDetail, ColumnList
│   │       │   ├── editor/             # SqlEditor (CodeMirror 6), ResultsTable,
│   │       │   │                       # QueryToolbar, DestructiveModal
│   │       │   ├── copilot/            # CopilotDrawer, MessageList, InputForm
│   │       │   ├── library/            # SavedQueryList, QuerySearch, QueryCard
│   │       │   └── admin/              # AdminDashboard, UserList, GroupManager
│   │       ├── hooks/
│   │       │   ├── useConnections.ts
│   │       │   ├── useSchema.ts
│   │       │   ├── useQueryStream.ts   # SSE streaming résultats de requêtes
│   │       │   └── useCopilotStream.ts # SSE streaming tokens IA
│   │       └── i18n/
│   │           ├── index.ts            # react-i18next init + lazy loading
│   │           └── locales/
│   │               └── en.json         # Traductions anglais (défaut MVP)
│   └── shared/                         # Code partagé backend ↔ frontend
│       ├── schemas/
│       │   ├── user.schema.ts
│       │   ├── connection.schema.ts
│       │   ├── query.schema.ts
│       │   └── saved-query.schema.ts
│       └── types/
│           └── index.ts
├── Dockerfile                          # Multi-stage: build → node:22-alpine
├── .env.example
├── .gitignore
├── package.json                        # Scripts: dev, build, test, lint
├── tsconfig.json
├── tsconfig.web.json
├── tsconfig.api.json
└── README.md
```

### Architectural Boundaries

**API Boundaries :**
- `/api/v1/*` — REST API JSON, JWT Bearer ou cookie httpOnly
- `/mcp` — MCP server (@hono/mcp), token API dblumi
- `/health` — No auth, liveness probe Docker
- `/*` — catch-all SPA (src/api/public/ en prod, proxy Vite en dev)

**Service Boundaries :**
- `connection-manager.ts` → seul composant créant/gérant les pools DB utilisateurs
- `encryption.ts` → seul composant chiffrant/déchiffrant les credentials
- `guardrails.ts` → appelé par `query-executor.ts` ET `copilot.ts` pour toute requête SQL
- `copilot.ts` → seul composant appelant l'API Anthropic

**Data Boundaries :**
- SQLite (Drizzle) → données internes dblumi uniquement
- pg / mysql2 → données des bases utilisateurs (jamais persistées côté dblumi)
- SSE streams → résultats et tokens en mémoire uniquement, jamais persistés

### Data Flow

```
Browser → Hono middleware (JWT + RBAC)
        → routes/ → services/
        → connection-manager → User DB (pg/mysql2)
        → query-executor → SSE stream → Browser
        → copilot → Claude API → SSE stream → Browser
        → Drizzle → SQLite (données internes)
```

### External Integrations

| Intégration | Service | Fichier |
|---|---|---|
| IA Copilote | Anthropic Claude API | `src/api/services/copilot.ts` |
| OAuth GitHub | GitHub OAuth2 (Arctic) | `src/api/services/auth.ts` |
| OAuth Google | Google OAuth2 (Arctic) | `src/api/services/auth.ts` |
| DB utilisateurs | PostgreSQL (pg) | `src/api/services/connection-manager.ts` |
| DB utilisateurs | MySQL (mysql2) | `src/api/services/connection-manager.ts` |
| Images Docker | ghcr.io + cosign | `.github/workflows/release.yml` |

### Requirements to Structure Mapping

| FR | Fichier(s) principal(aux) |
|---|---|
| FR01-07 Connexions | `routes/connections.ts`, `services/connection-manager.ts`, `services/encryption.ts` |
| FR08-11 Schéma | `routes/schema.ts`, `services/schema-inspector.ts`, `features/schema/` |
| FR12-18 Éditeur SQL | `routes/query.ts`, `services/query-executor.ts`, `services/guardrails.ts`, `features/editor/` |
| FR19-25 Copilote IA | `routes/ai.ts`, `services/copilot.ts`, `features/copilot/` |
| FR26-31 Bibliothèque | `routes/saved-queries.ts`, `features/library/` |
| FR32-37 Équipe & Auth | `routes/auth.ts`, `routes/users.ts`, `routes/groups.ts`, `services/auth.ts`, `features/auth/`, `features/admin/` |
| FR38 REST API | `routes/` + OpenAPI via `@hono/zod-openapi` |
| FR39 MCP Server | `mcp/server.ts` |
| FR40 Docker | `Dockerfile`, `docker/docker-compose.yml` |
| FR41 Admin dashboard | `routes/admin.ts`, `features/admin/` |
| FR42 Démo | Instance séparée, même codebase, `DEMO_MODE=true` via env |
| FR43 i18n | `web/src/i18n/` |
| FR44 Telemetry | `services/telemetry.ts` |

---

## Architecture Validation Results

### Coherence Validation ✅

Toutes les technologies choisies sont compatibles et sans conflits de version. Les patterns (naming, state, error handling) sont cohérents avec le stack. La structure du projet supporte toutes les décisions architecturales.

### Requirements Coverage Validation ✅

44/44 FRs couverts architecturalement — voir mapping dans Project Structure & Boundaries. Tous les NFRs (performance, sécurité, accessibilité, compatibilité Docker) adressés.

### Gap Analysis

| Gap | Priorité | Résolution intégrée |
|---|---|---|
| Mode démo (FR42) | Mineur | `DEMO_MODE=true` env var — désactive mutations DML/DDL, force connexion SQLite pré-peuplée |
| Annulation requête (FR18) | Mineur | `AbortController` dans `useQueryStream.ts` + `signal` dans `query-executor.ts` |
| Export CSV/JSON (FR17) | Mineur | `GET /api/v1/connections/:id/query/export?format=csv\|json` dans `routes/query.ts` |

### Architecture Completeness Checklist

- [x] Contexte projet analysé (complexité, contraintes, cross-cutting concerns)
- [x] Décisions architecturales documentées avec versions vérifiées
- [x] Stack technologique complet spécifié
- [x] Patterns d'implémentation définis (naming, structure, format, state, errors)
- [x] Structure complète du projet avec mapping FRs → fichiers
- [x] Boundaries et intégrations externes cartographiées
- [x] Data flow documenté
- [x] Tous les NFRs couverts

### Architecture Readiness Assessment

**Statut global : PRÊT POUR L'IMPLÉMENTATION**
**Niveau de confiance : ÉLEVÉ**

**Points forts :**
- Stack TypeScript unifié frontend/backend — Zod schemas partagés, types inférés end-to-end
- Proxy backend obligatoire — security-by-design pour un outil accédant aux DB de production
- SSE uniquement pour le streaming — un seul mécanisme, cohérent
- SQLite interne → PostgreSQL Phase 2 sans friction (Drizzle supporte les deux)
- shadcn/ui (Radix UI) — WCAG AA gratuit, pas de dette accessibilité

**Axes d'amélioration future :**
- Migration SQLite → PostgreSQL pour Phase 2 cloud managé
- Cache distribué (Redis) si multi-instances
- Rate limiting par utilisateur/clé API (post-MVP)
- SAML/Okta SSO enterprise (post-MVP)

### Implementation Handoff

**Première story d'implémentation :**

```bash
mkdir dblumi && cd dblumi
npm create hono@latest .
pnpm create vite src/web --template react-ts
# Setup tsconfig, Dockerfile, .env.example, GitHub Actions CI/CD
```

**Tous les agents IA doivent :**
- Référencer ce document pour toute décision architecturale
- Suivre les 10 règles des Implementation Patterns
- Respecter les boundaries de service (connection-manager, encryption, guardrails, copilot)
- Ne jamais exposer de credentials DB côté navigateur
