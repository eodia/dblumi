---
title: "Product Brief Distillate: dblumi"
type: llm-distillate
source: "product-brief-dblumi.md"
created: "2026-03-28"
purpose: "Token-efficient context for downstream PRD creation"
---

# Distillate — dblumi

## Identité produit

- Nom : dblumi (visualiseur de bases de données web)
- Positionnement : "le premier client DB que toute l'équipe partage vraiment" — pas "meilleur DBeaver"
- Tagline implicite : open source + web-natif + UX soignée + IA native au schéma — aucun concurrent ne réunit les 4
- Modèle économique : open source (GitHub Sponsors) → cloud managé payant (Phase 2)
- Benchmark de lancement : 1 000 étoiles GitHub en 30j, 5 000 à 6 mois = déclencheur Phase 2

## Stack et déploiement

- Déploiement : Docker first-class — `docker run` en une commande, `docker-compose.yml` fourni
- Objectif UX de démarrage : de `docker run` à la première requête en < 90 secondes
- Configuration par variables d'environnement Docker
- Clé API Claude : configurable en env var (`ANTHROPIC_API_KEY`) au niveau instance, surchargeabe en BYOK par utilisateur
- Interface en anglais pour le MVP (i18n post-MVP)

## Modèle de sécurité et connexions DB

- Deux niveaux de connexions :
  - **Globales** : créées par l'admin, assignées à des groupes avec permissions — credentials chiffrés, non lisibles post-saisie même par l'admin (write-once, use-always)
  - **Personnelles** : chaque utilisateur gère ses connexions privées, visibles uniquement par lui
- Toutes les connexions chiffrées au repos (modèle à préciser en architecture : AES-256, vault, etc.)
- Accès contrôlé par groupes — un utilisateur appartient à un ou plusieurs groupes
- Credentials jamais exposés en clair dans l'UI

## Gestion d'équipe et droits

- Authentification intégrée (mécanisme exact à définir en PRD : user/password local, OAuth, SSO ?)
- Groupes d'utilisateurs avec droits d'accès aux connexions globales
- Rôles envisagés : admin / éditeur / lecteur (à affiner en PRD)
- Les groupes contrôlent quelles connexions globales sont visibles et avec quelles permissions (lecture seule vs. lecture-écriture)

## SQL et éditeur

- SQL complet : DQL (SELECT), DML (INSERT, UPDATE, DELETE), DDL (CREATE, DROP, ALTER, VIEW, INDEX…)
- Guardrails UX obligatoires :
  - Confirmation modale avant toute requête destructive (DROP, TRUNCATE, DELETE sans WHERE)
  - Warning visible sur DELETE/UPDATE sans clause WHERE
  - Le copilote IA doit signaler explicitement quand il génère une requête destructive
- Coloration syntaxique + autocomplétion (noms de tables/colonnes depuis le schéma connecté)

## Copilote IA (Claude)

- Natif au schéma : le copilote connaît la structure complète de la DB connectée
- Fonctionnalités MVP : NL → SQL, SQL → explication en langage naturel, suggestions contextuelles
- Signalement des requêtes destructives générées
- Pas de rate limiting en MVP (décision volontaire, à revisiter en Phase 2)
- BYOK = les données clients ne transitent pas par les serveurs dblumi via le chemin IA — argument sécurité fort

## Utilisateurs cibles

- **Primaire** : ingénieur backend/fullstack en équipe 3–30 personnes, PostgreSQL ou MySQL, frustré par DBeaver ou l'absence d'outil web décent — introduit l'outil via `docker-compose.yml`
- **Secondaire** : admin/tech lead — configure l'instance, gère les groupes, surveille les accès, valorise audit et sécurité
- **Tertiaire** : développeur solo/freelance — connexions personnelles, point d'entrée vers la communauté GitHub

## Bases de données

- MVP : PostgreSQL et MySQL uniquement
- Post-MVP : autres bases (SQLite, MongoDB, Redis, Snowflake, BigQuery, SQL Server…)
- Architecture cible : connecteurs communautaires pour élargir le support progressivement

## Périmètre MVP — explicitement hors scope

- Bases de données autres que PostgreSQL et MySQL
- Migrations assistées / gestion de schéma (ALTER via wizard, etc.)
- Version cloud managée
- Analytics / BI / tableaux de bord
- Intégration CI/CD
- Rate limiting de la clé API par utilisateur
- Internationalisation

## Stratégie de lancement

- Show HN + Product Hunt lancés le même jour
- Démo en ligne (base de démonstration read-only) pour conversion immédiate sans déploiement requis
- README soigné avec GIF de démo animée + `docker run` en une ligne
- Objectif : trafic organique développeur via ces deux canaux + bouche-à-oreille équipe

## Opportunités post-MVP identifiées (non dans le scope actuel)

- Bibliothèque de requêtes partagées en équipe (mémoire institutionnelle, fort vecteur de rétention)
- Audit log / journal des requêtes exécutées (par qui, quand, quoi) — justifie le tier payant et débloque industries régulées
- Détection de drift de schéma (alertes sur changements de structure)
- Liens de partage read-only de résultats de requêtes (viral loop cross-fonctionnel)
- Multi-workspace pour agences / consultants gérant plusieurs clients

## Partenariats potentiels identifiés

- Supabase / Neon / Railway / PlanetScale : bouton "Open in dblumi" dans leurs dashboards
- Plateformes self-hosting (Coolify, Dokploy) : template one-click install
- Anthropic : co-marketing / showcase Claude API — crédibilité + distribution

## Concurrents clés à surveiller

- **Chat2DB** : concurrent direct le plus dangereux — IA-first open source, mais UX inconsistante et pas Claude — surveiller activement
- **DataGrip (JetBrains)** : meilleur concurrent incumbent — payant, bureau, mais IA intégrée et confiance développeur forte
- **CloudBeaver** : "DBeaver dans un navigateur" — web + Docker mais hérite de toute la lourdeur Java — facilement battu sur UX
- **DbGate** : web + bureau, open source, activement maintenu — UI fonctionnelle mais sans soin — concurrent silencieux à surveiller

## Questions ouvertes pour le PRD

- Mécanisme d'authentification exact du MVP : user/password local uniquement, ou OAuth (GitHub/Google) dès le MVP ?
- Modèle de chiffrement des credentials : clé de chiffrement gérée comment (env var, secret Docker, vault) ?
- Périmètre exact des rôles : 3 rôles fixes (admin/éditeur/lecteur) ou permissions granulaires par connexion/groupe ?
- Proxy DB ou connexion directe navigateur → DB ? (impact sécurité majeur : si connexion directe, les credentials doivent être côté client, sinon backend proxy)
- La démo en ligne est-elle un environnement séparé hébergé ou un Docker partagé ?
