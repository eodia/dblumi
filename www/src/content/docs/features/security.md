---
title: Security & Guardrails
---

dblumi is built with security as a first-class concern.

## Query guardrails

Before any destructive query runs, dblumi shows a confirmation modal with the risk level. See [SQL Editor → Safety guardrails](/features/sql-editor/#safety-guardrails) for the full breakdown.

## Credential storage

- Database passwords are encrypted with **AES-256-GCM**
- AI provider API keys are encrypted with **AES-256**
- Credentials never leave your server

## Authentication

- Email/password with secure hashed storage
- OAuth/SSO: Keycloak, GitHub, Google
- JWT-based sessions with token revocation

## Role-based access control

| Role | Capabilities |
|------|-------------|
| Admin | Full access — users, groups, connections |
| Editor | Create and edit queries, manage own connections |
| Viewer | Read-only access to shared queries and connections |

## Connection access control

Each connection can be private, shared with specific users, or shared with groups. Admins can see all connections.