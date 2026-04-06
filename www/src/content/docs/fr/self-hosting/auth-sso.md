---
title: Auth & SSO
---

dblumi supporte l'authentification locale et plusieurs fournisseurs OAuth/SSO.

## Authentification locale

Activee par defaut. Les utilisateurs s'inscrivent avec email et mot de passe.

Les utilisateurs peuvent changer leur mot de passe depuis le menu utilisateur dans la barre laterale. Pour activer le lien "Mot de passe oublie ?" sur la page de connexion, configurez le SMTP (voir [Variables d'environnement](/fr/self-hosting/environment-variables/#smtp-reinitialisation-de-mot-de-passe)).

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
