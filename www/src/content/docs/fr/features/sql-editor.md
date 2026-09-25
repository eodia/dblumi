---
title: Editeur SQL
---

L'editeur SQL est le coeur de dblumi. Il supporte PostgreSQL, MySQL, SQL Server, Oracle, SQLite, Trino et Snowflake avec coloration syntaxique, auto-complétion et streaming des résultats en temps réel — et parle mongosh sur MongoDB et redis-cli sur Redis.

![Editeur SQL avec coloration syntaxique et resultats](/dblumi/images/feature-editor.png)

## Fonctionnalites cles

- **Coloration syntaxique** pour PostgreSQL, MySQL, SQL Server (T-SQL), Oracle, SQLite, Trino et Snowflake (la grammaire PostgreSQL est utilisée pour SQLite, Trino et Snowflake), les commandes mongosh et les commandes redis-cli
- **Auto-completion** pour les noms de tables, colonnes et mots-cles SQL
- **Execution partielle** — selectionnez une partie de la requete et executez uniquement celle-ci
- **Streaming des resultats** — les lignes apparaissent au fur et a mesure, sans attendre le jeu de resultats complet
- **Historique des requetes** — chaque requete executee est sauvegardee et accessible depuis la Vue d'ensemble
- **Export des resultats** — telechargement en CSV, JSON ou SQL

## Garde-fous de securite

dblumi detecte les requetes potentiellement destructrices et vous avertit avant l'execution :

| Niveau | Couleur | Exemples |
|--------|---------|----------|
| 1 | Bleu | INSERT, UPDATE, DELETE |
| 2 | Jaune | Mises a jour massives sans WHERE |
| 3 | Orange | DROP, TRUNCATE |
| 4 | Rouge | DROP DATABASE, DROP SCHEMA |

Vous devez confirmer explicitement avant qu'une requete signalee ne s'execute.
