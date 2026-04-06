---
title: Auth & SSO
---

dblumi supports local authentication and several OAuth/SSO providers.

## Local authentication

Enabled by default. Users register with email and password.

Users can change their password from the user menu in the sidebar. To enable the "Forgot password?" flow on the login page, configure SMTP (see [Environment variables](/self-hosting/environment-variables/#smtp-password-reset)).

## GitHub OAuth

```env
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

## Google OAuth

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

## Keycloak (OIDC)

```env
KEYCLOAK_URL=https://your-keycloak/auth
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=dblumi
KEYCLOAK_CLIENT_SECRET=your-client-secret
```

Multiple providers can be enabled simultaneously.