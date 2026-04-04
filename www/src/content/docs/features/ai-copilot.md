---
title: AI Copilot
---

dblumi includes an AI assistant that can generate, explain, and optimize SQL queries.

## Supported providers

| Provider | Models |
|----------|--------|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Haiku |
| OpenAI | GPT-4o, GPT-4 Turbo |
| Azure OpenAI | Your deployed models |

Bring your own API key — dblumi never proxies your requests.

## What the copilot can do

- **Generate SQL** from a natural language description
- **Explain** a query in plain English
- **Optimize** a slow query
- **Answer questions** about your schema

## Context awareness

The copilot is aware of your current query, the active table, and your database schema — so its suggestions are relevant to your actual data model.

## Setup

Go to **Settings → AI Copilot**, select your provider, and enter your API key. Keys are encrypted at rest (AES-256).