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

## Copilot IA

| Variable | Obligatoire | Defaut | Description |
|----------|-------------|--------|-------------|
| `ANTHROPIC_API_KEY` | Non | — | Cle API Anthropic pour les modeles Claude |
| `OPENAI_API_KEY` | Non | — | Cle API OpenAI |
| `AZURE_OPENAI_API_KEY` | Non | — | Cle API Azure OpenAI |
| `AZURE_OPENAI_ENDPOINT` | Non | — | URL de l'endpoint Azure OpenAI |
| `AZURE_OPENAI_DEPLOYMENT` | Non | — | Nom du deploiement Azure OpenAI |
| `OLLAMA_BASE_URL` | Non | — | URL du serveur Ollama (ex : `http://localhost:11434`) |
| `OLLAMA_MODEL` | Non | — | Nom du modele Ollama (ex : `codestral`, `llama3.1`) |

## SMTP (reinitialisation de mot de passe)

Requis uniquement pour la fonctionnalite "Mot de passe oublie ?". Sans SMTP, les utilisateurs peuvent changer leur mot de passe depuis le menu de leur profil (une fois connectes).

| Variable | Obligatoire | Defaut | Description |
|----------|-------------|--------|-------------|
| `SMTP_HOST` | Non | — | Nom d'hote du serveur SMTP |
| `SMTP_PORT` | Non | `587` | Port du serveur SMTP |
| `SMTP_USER` | Non | — | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Non | — | Mot de passe SMTP |
| `SMTP_FROM` | Non | — | Adresse email de l'expediteur (ex : `noreply@votre-domaine.com`) |

Exemple avec Gmail :

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-application
SMTP_FROM=votre-email@gmail.com
```
