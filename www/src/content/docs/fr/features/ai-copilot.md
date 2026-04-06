---
title: Copilot IA
---

dblumi inclut un assistant IA capable de generer, expliquer et optimiser les requetes SQL.

## Fournisseurs supportes

| Fournisseur | Modeles |
|-------------|---------|
| Anthropic | Tous les modeles — Claude Opus 4, Sonnet 4, Haiku, et les futurs modeles |
| OpenAI | Tous les modeles — GPT-4o, GPT-4.1, o3, o4-mini, et les futurs modeles |
| Azure OpenAI | Tout modele deploye dans votre abonnement Azure |

Configurez le modele via les variables d'environnement. dblumi utilise les meilleurs modeles par defaut (Claude Sonnet 4 pour Anthropic, GPT-4o pour OpenAI) mais vous pouvez choisir n'importe quel modele propose par votre fournisseur.

Utilisez votre propre cle API — dblumi ne fait jamais transiter vos requetes par un proxy.

## Ce que le copilote peut faire

- **Generer du SQL** a partir d'une description en langage naturel
- **Expliquer** une requete en termes simples
- **Optimiser** une requete lente
- **Repondre aux questions** sur votre schema

![Le Copilot IA genere une requete SQL a partir d'une description en langage naturel](/dblumi/images/feature-ai.png)

## Connaissance du contexte

Le copilote connait votre requete actuelle, la table active et le schema de votre base de donnees — ses suggestions sont donc pertinentes pour votre modele de donnees reel.

## Configuration

Allez dans **Parametres → Copilot IA**, selectionnez votre fournisseur et saisissez votre cle API. Les cles sont chiffrees au repos (AES-256).
