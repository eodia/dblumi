---
title: Auth & SSO
---

dblumi supporte l'authentification locale et plusieurs fournisseurs OAuth/SSO.

## Authentification locale

Activee par defaut. Les utilisateurs s'inscrivent avec email et mot de passe.

## GitHub OAuth

```env
GITHUB_CLIENT_ID=votre-client-id
GITHUB_CLIENT_SECRET=votre-client-secret
```

## Google OAuth

```env
GOOGLE_CLIENT_ID=votre-client-id
GOOGLE_CLIENT_SECRET=votre-client-secret
```

## Keycloak (OIDC)

```env
KEYCLOAK_URL=https://votre-keycloak/auth
KEYCLOAK_REALM=votre-realm
KEYCLOAK_CLIENT_ID=dblumi
KEYCLOAK_CLIENT_SECRET=votre-client-secret
```

Plusieurs fournisseurs peuvent etre actives simultanement.
