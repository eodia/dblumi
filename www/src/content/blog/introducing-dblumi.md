---
title: "Introducing dblumi v0.1.0"
description: "The modern SQL client with AI copilot is here. Self-hosted, open source, team-ready. Here's what's inside."
date: 2026-04-16
author: "Marc Jamain"
tags: ["release", "open-source", "sql"]
---

After months of building, testing, and rewriting — **dblumi v0.1.0 is here**.

dblumi is a self-hosted, open-source SQL client with a built-in AI copilot. It's designed for development teams who want to query, explore, and ship — without the usual friction of juggling tools.

## Why another SQL client?

Most SQL clients fall into two camps: either they're heavyweight desktop apps trapped in the 2000s, or they're cloud-hosted SaaS tools that want your data on their servers. We wanted something different:

- **Self-hosted** — your data never leaves your network
- **Team-first** — real-time collaboration, shared queries, role-based access
- **AI-native** — a copilot that actually knows your schema
- **Multi-driver** — Postgres, MySQL, Oracle, SQLite in one window

## What's in v0.1.0

### SQL Editor
A keyboard-first, multi-tab editor powered by CodeMirror 6. Schema-aware autocomplete, EXPLAIN plan analysis, streaming results, and export to CSV/JSON/SQL.

### AI Copilot
Ask questions in plain language, get working SQL grounded in your schema. Supports Anthropic Claude, OpenAI, Azure OpenAI, and local Ollama. BYOK — your API keys, your privacy.

### Real-time Collaboration
Two people on the same query see each other's cursors in real time, powered by Yjs. Every save creates a version. Browse the timeline, diff any two versions, restore in one click.

### 4 Database Drivers
Postgres, MySQL, Oracle, and SQLite — all with connection pooling, SSL/TLS, and AES-256-GCM credential encryption.

### Security
4 safety levels from unrestricted dev to locked production. Destructive query detection, JWT auth with token revocation, SSO via GitHub, Google, and Keycloak.

### REST API
Every resource exposed via a clean REST API with Swagger UI. Turn any saved query into a JSON endpoint.

## What's next

We're already working on **MongoDB support**, an **MCP server** for AI agents, **dark mode**, and a **query scheduler**. Check the [roadmap](/dblumi/roadmap/) for the full picture.

## Get started

```bash
docker run -p 5173:5173 eodia/dblumi
```

Open `http://localhost:5173`, create your account, add a connection, and start querying.

dblumi is AGPL-3.0 — every feature, forever free. Star us on [GitHub](https://github.com/eodia/dblumi), join the [Discord](https://discord.gg/2uTk5X9B), and let us know what you think.
