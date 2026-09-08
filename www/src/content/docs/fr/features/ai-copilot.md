---
title: Copilot IA
---

dblumi inclut un assistant IA capable de generer, expliquer et optimiser les requetes SQL.

## Fournisseurs supportes

| Fournisseur | Modeles |
|-------------|---------|
| Anthropic | Tous les modeles — Claude Opus 4, Sonnet 4, Haiku, et les futurs modeles |
| Mistral | Tous les modeles servis par l'API Mistral — via son endpoint compatible OpenAI |
| OpenAI | Tous les modeles — GPT-4o, GPT-4.1, o3, o4-mini, et les futurs modeles |
| Azure OpenAI | Tout modele deploye dans votre abonnement Azure |
| Ollama | Tout modele heberge localement — Llama, Mistral, Codestral, et plus |

Configurez le modele via les variables d'environnement. dblumi utilise les meilleurs modeles par defaut (Claude Sonnet 4 pour Anthropic, GPT-4o pour OpenAI, `mistral-large-latest` pour Mistral) mais vous pouvez choisir n'importe quel modele propose par votre fournisseur.

Utilisez votre propre cle API — ou fonctionnez entierement hors-ligne avec Ollama. dblumi ne fait jamais transiter vos requetes par un proxy.

## Ce que le copilote peut faire

- **Generer du SQL** a partir d'une description en langage naturel
- **Expliquer** une requete en termes simples
- **Optimiser** une requete lente
- **Repondre aux questions** sur votre schema

![Le Copilot IA genere une requete SQL a partir d'une description en langage naturel](/dblumi/images/feature-ai.png)

## Connaissance du contexte

Le copilote connait votre requete actuelle, la table active et le schema de votre base de donnees — ses suggestions sont donc pertinentes pour votre modele de donnees reel.

## Configuration

Le copilote se configure avec des **variables d'environnement** cote serveur — il n'y a pas d'ecran de saisie de cle dans l'application. Definissez les variables du fournisseur souhaite puis redemarrez dblumi :

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Mistral
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-large-latest

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://votre-ressource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Ollama (100% local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

Configurez **un seul fournisseur a la fois**. Si plusieurs sont definis, dblumi retient le premier dans cet ordre : `ollama` > `anthropic` > `mistral` > `azure-openai` > `openai`.

Voir [Variables d'environnement](/dblumi/fr/self-hosting/environment-variables/) pour la reference complete.
