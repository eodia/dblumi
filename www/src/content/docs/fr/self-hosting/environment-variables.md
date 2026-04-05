---
title: Variables d'environnement
---

## Essentielles

| Variable | Obligatoire | Defaut | Description |
|----------|-------------|--------|-------------|
| `JWT_SECRET` | Oui | — | Cle secrete pour la signature des tokens JWT. Utilisez une longue chaine aleatoire. |
| `PORT` | Non | `3000` | Port d'ecoute du serveur |
| `DATA_DIR` | Non | `./data` | Repertoire pour la base SQLite et les identifiants chiffres |

## Authentification

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `GITHUB_CLIENT_ID` | Non | ID client de l'app OAuth GitHub |
| `GITHUB_CLIENT_SECRET` | Non | Secret client de l'app OAuth GitHub |
| `GOOGLE_CLIENT_ID` | Non | ID client OAuth Google |
| `GOOGLE_CLIENT_SECRET` | Non | Secret client OAuth Google |
| `KEYCLOAK_URL` | Non | URL de base Keycloak |
| `KEYCLOAK_REALM` | Non | Realm Keycloak |
| `KEYCLOAK_CLIENT_ID` | Non | ID client Keycloak |
| `KEYCLOAK_CLIENT_SECRET` | Non | Secret client Keycloak |
