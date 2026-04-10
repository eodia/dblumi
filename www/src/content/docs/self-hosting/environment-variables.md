---
title: Environment variables
---

## Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret key for signing JWT tokens. Use a long random string. |
| `PORT` | No | `3000` | Port the server listens on |
| `DATA_DIR` | No | `./data` | Directory for the SQLite database and encrypted credentials |

## Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | No | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app client secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `KEYCLOAK_URL` | No | Keycloak base URL |
| `KEYCLOAK_REALM` | No | Keycloak realm |
| `KEYCLOAK_CLIENT_ID` | No | Keycloak client ID |
| `KEYCLOAK_CLIENT_SECRET` | No | Keycloak client secret |

## AI Copilot

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | No | — | OpenAI API key |
| `AZURE_OPENAI_API_KEY` | No | — | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | No | — | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | No | — | Azure OpenAI deployment name |
| `OLLAMA_BASE_URL` | No | — | Ollama server URL (e.g. `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | — | Ollama model name (e.g. `codestral`, `llama3.1`) |

## SMTP (password reset)

Required only if you want the "Forgot password?" feature. Without SMTP, users can only change their password from their profile menu (when logged in).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | No | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | — | Sender email address (e.g. `noreply@your-domain.com`) |

Example with Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```