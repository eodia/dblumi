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

- Email/password with secure hashed storage (Argon2)
- OAuth/SSO: Keycloak, GitHub, Google
- JWT-based sessions with token revocation

## Password management

- **Change password** from the user menu (for local accounts, not OAuth)
- **Forgot password** with email reset link (requires SMTP configuration)
- Password strength indicator (weak / fair / strong)
- Reset tokens are hashed (SHA-256) and single-use, expiring after 1 hour
- All existing sessions are invalidated after a password change or reset

## Role-based access control

| Role | Capabilities |
|------|-------------|
| Admin | Full access — users, groups, connections |
| Editor | Create and edit queries, manage own connections |
| Viewer | Read-only access to shared queries and connections |

## Connection access control

Each connection can be private, shared with specific users, or shared with groups. Admins can see all connections.