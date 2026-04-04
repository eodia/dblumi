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