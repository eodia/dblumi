---
title: Copilot IA
---

dblumi inclut un assistant IA capable de generer, expliquer et optimiser les requetes SQL.

## Fournisseurs supportes

| Fournisseur | Modeles |
|-------------|---------|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Haiku |
| OpenAI | GPT-4o, GPT-4 Turbo |
| Azure OpenAI | Vos modeles deployes |

Utilisez votre propre cle API — dblumi ne fait jamais transiter vos requetes par un proxy.

## Ce que le copilote peut faire

- **Generer du SQL** a partir d'une description en langage naturel
- **Expliquer** une requete en termes simples
- **Optimiser** une requete lente
- **Repondre aux questions** sur votre schema

## Connaissance du contexte

Le copilote connait votre requete actuelle, la table active et le schema de votre base de donnees — ses suggestions sont donc pertinentes pour votre modele de donnees reel.

## Configuration

Allez dans **Parametres → Copilot IA**, selectionnez votre fournisseur et saisissez votre cle API. Les cles sont chiffrees au repos (AES-256).
