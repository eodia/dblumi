---
title: AI Copilot
---

dblumi includes an AI assistant that can generate, explain, and optimize SQL queries.

## Supported providers

| Provider | Models |
|----------|--------|
| Anthropic | All models — Claude Opus 4, Sonnet 4, Haiku, and future releases |
| OpenAI | All models — GPT-4o, GPT-4.1, o3, o4-mini, and future releases |
| Azure OpenAI | Any model deployed in your Azure subscription |

Configure the model via environment variables. dblumi always uses the latest defaults (Claude Sonnet 4 for Anthropic, GPT-4o for OpenAI) but you can choose any model your provider offers.

Bring your own API key — dblumi never proxies your requests.

## What the copilot can do

- **Generate SQL** from a natural language description
- **Explain** a query in plain English
- **Optimize** a slow query
- **Answer questions** about your schema

![AI Copilot generating a SQL query from a natural language prompt](/images/feature-ai.png)

## Context awareness

The copilot is aware of your current query, the active table, and your database schema — so its suggestions are relevant to your actual data model.

## Setup

Go to **Settings → AI Copilot**, select your provider, and enter your API key. Keys are encrypted at rest (AES-256).