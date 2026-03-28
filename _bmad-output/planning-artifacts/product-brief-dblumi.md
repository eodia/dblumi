---
title: "Product Brief: dblumi"
status: "complete"
created: "2026-03-28"
updated: "2026-03-28"
inputs: ["conversation utilisateur", "recherche concurrentielle web"]
---

# Product Brief : dblumi

## Résumé exécutif

Les développeurs et équipes techniques passent des heures chaque semaine dans des clients de base de données qui les font souffrir : DBeaver est lent comme du sable, TablePlus est beau mais payant et cloué au bureau, et les alternatives web existantes ne sont que DBeaver dans un navigateur — avec la même lourdeur. Il n'existe aujourd'hui aucun outil qui combine open source, déploiement web-natif, interface soignée et IA native au schéma.

dblumi comble ce vide. C'est un visualiseur de bases de données 100 % web, open source, déployable en une commande Docker, avec un copilote IA intégré — propulsé par Claude — qui comprend votre schéma et traduit le langage naturel en SQL. Pas d'installation. Pas de friction. Une interface dont les développeurs ne seront pas honteux.

Le projet adopte un modèle open source (GitHub Sponsors) avec une trajectoire claire vers un tier cloud managé pour les équipes — une approche éprouvée dans l'outillage développeur.

---

## Le problème

Un développeur rejoint une nouvelle équipe. Première tâche : inspecter la base de production. Il installe DBeaver — 200 Mo de Java qui met 30 secondes à démarrer, dont l'interface date de 2008 et qui plante à l'autocomplétion. Son collègue lui recommande CloudBeaver, la version web. Même moteur, même chaos, juste dans un navigateur. TablePlus ? Payant, macOS uniquement, et ça ne se partage pas avec l'équipe.

Ce scénario se répète dans chaque équipe technique en 2025. Les douleurs concrètes :

- **Lourdeur** : clients desktop à installer, maintenir et mettre à jour sur chaque machine
- **UX daté** : les outils dominants (DBeaver, phpMyAdmin) n'ont pas évolué depuis une décennie
- **Pas de partage d'équipe** : les connexions DB vivent sur la machine de chacun, pas de source de vérité partagée
- **IA bolted-on ou absente** : DataGrip a ajouté une IA en 2024 (payant), Chat2DB propose du text-to-SQL mais l'UX est inconsistante
- **Friction au démarrage** : aucun outil web sérieux ne s'installe en `docker run`

---

## La solution

dblumi est un client web de base de données conçu pour les équipes modernes.

**Connexion instantanée** — une chaîne de connexion, et vous êtes dans votre base. PostgreSQL et MySQL au lancement, les autres bases de données post-MVP.

**Interface raffinée** — une UI pensée pour les développeurs qui apprécient le soin : navigation du schéma fluide, éditeur SQL avec coloration et autocomplétion, visualisation des données claire.

**Copilote IA natif au schéma** — le copilote (Claude) connaît votre schéma connecté. Il traduit le langage naturel en SQL, explique les requêtes, suggère des optimisations et répond aux questions sur votre modèle de données. Pas un outil séparé — intégré dans chaque interaction.

**Déploiement Docker first-class** — une image Docker soignée, une commande, une configuration par variables d'environnement. L'équipe partage une instance, pas dix installations.

**Gestion d'équipe** — authentification intégrée, gestion par groupes, partage des connexions DB avec contrôle fin des droits. Deux niveaux de connexions :
- **Connexions globales** : configurées par l'admin, assignées à des groupes avec permissions spécifiques — les membres accèdent sans jamais voir les credentials en clair (write-once, use-always)
- **Connexions personnelles** : chaque utilisateur gère ses propres connexions privées

Toutes les connexions sont chiffrées au repos. La clé API Claude est configurable au niveau de l'instance (variable d'environnement) ou au niveau utilisateur (BYOK).

---

## Ce qui rend dblumi différent

| Dimension | dblumi | Concurrents |
|---|---|---|
| Open source + web-natif | ✅ | CloudBeaver (UX lourde), DbGate (UI non soignée) |
| UX raffinée | ✅ | TablePlus (bureau, payant), DBeaver (daté) |
| IA native au schéma | ✅ Claude intégré | DataGrip (bolt-on, payant), Chat2DB (Claude non intégré) |
| Docker one-liner | ✅ | Rare chez les concurrents bien finis |
| Partage équipe + RBAC | ✅ | Absent des outils desktop |
| Open source auditible | ✅ | Sujet à approbation sécurité en entreprise |

**L'avantage clé** : aucun concurrent ne réunit tous ces attributs. Le positionnement n'est pas "meilleur DBeaver" — c'est **le premier client DB que toute l'équipe partage vraiment**.

**Moat à court terme** : qualité d'exécution (UI et expérience IA), vitesse de développement, et un RBAC open source enterprise-grade — rare dans cette catégorie. La fenêtre d'opportunité existe parce que DBeaver régresse activement (issues GitHub en hausse en 2025) et que Chat2DB ne mise pas sur la qualité UI.

**BYOK comme avantage de confiance** : le modèle Bring Your Own Key signifie que les données clients ne transitent jamais par les serveurs de dblumi via le chemin IA — un argument direct contre les objections des équipes sécurité.

**L'expérience de démarrage** : de `docker run` à la première requête sur sa base de données en moins de 90 secondes. C'est la promesse, c'est le benchmark, c'est le moment de vérité.

---

## À qui s'adresse dblumi

**Utilisateur primaire — le développeur en équipe**
Ingénieur backend ou fullstack, 2–10 ans d'expérience, travaille dans une équipe de 3 à 30 personnes. Utilise PostgreSQL ou MySQL. Frustré par DBeaver ou par l'absence d'outil web décent. Convaincu par une belle interface et une IA qui "comprend" vraiment sa base. Introduit l'outil dans son équipe via un `docker-compose.yml`.

**Utilisateur secondaire — l'admin / tech lead**
Configure l'instance, gère les accès, surveille les usages. Valorise la sécurité (credentials, audit), la simplicité d'administration et la fiabilité.

**Adopteur en solo**
Développeur indépendant ou freelance qui veut un client web léger pour ses projets personnels. Point d'entrée vers la communauté GitHub.

---

## Critères de succès

**MVP (Phase 1 — self-hosted open source)**
- ⭐ **1 000 étoiles GitHub dans les 30 jours post-lancement** — seuil de validation de la désirabilité (référence : lancements HN/Product Hunt comparables dans la catégorie devtools)
- ⭐ **5 000 étoiles à 6 mois** — seuil de déclenchement de la Phase 2 (cloud managé)
- Instances Docker déployées (via telemetry opt-in)
- Nombre de sponsors GitHub actifs

**Stratégie de lancement**
- Lancement coordonné : Show HN + Product Hunt le même jour
- Démo en ligne (read-only) pour conversion immédiate sans déploiement
- README soigné avec GIF de démo et `docker run` en une ligne

**Phase 2 — cloud managé**
- Comptes équipe actifs (MRR)
- Rétention à 30 / 90 jours
- Requêtes IA exécutées par session (proxy d'engagement)

---

## Périmètre

### MVP — dans le scope

- Connexion PostgreSQL et MySQL via chaîne de connexion
- Navigation du schéma (tables, colonnes, index, relations)
- Éditeur SQL complet : DQL, DML (INSERT, UPDATE, DELETE), DDL (CREATE, DROP, ALTER, VIEW…) — avec guardrails UX (confirmation sur requêtes destructives, warning sur DELETE sans WHERE)
- Copilote IA : text-to-SQL, explication de requêtes, suggestions contextuelles, signalement des requêtes destructives générées
- Gestion d'équipe : authentification, groupes, droits par groupe, connexions globales et personnelles
- Chiffrement de toutes les connexions au repos — credentials non lisibles même par l'admin post-saisie
- Configuration Claude : clé partagée (env var Docker) et BYOK par utilisateur
- Image Docker soignée avec `docker-compose.yml` exemple
- Démo en ligne avec base de données de démonstration (read-only)
- Interface en anglais (internationalisation post-MVP)

### Hors scope MVP

- Bases de données autres que PostgreSQL et MySQL
- Migrations assistées et gestion de schéma
- Version cloud managée
- Tableau de bord analytics / BI
- Intégration CI/CD
- Rate limiting de la clé API par utilisateur

---

## Vision à 2–3 ans

dblumi devient la référence open source du client DB web — le "VS Code des bases de données". La version self-hosted reste gratuite et complète. La version cloud managée (dblumi Cloud) offre hébergement, backups, SSO et support prioritaire pour les équipes qui ne veulent pas opérer leur propre instance.

Le copilote IA évolue vers un véritable assistant de base de données : détection d'anomalies, suggestions d'optimisation de requêtes, génération de documentation de schéma, alertes sur les changements de structure. La bibliothèque de requêtes partagées devient la mémoire institutionnelle de l'équipe.

Support étendu aux bases de données populaires (SQLite, MongoDB, Redis, Snowflake, BigQuery) — chaque nouveau connecteur, contribué par la communauté, élargit l'audience et le TAM. dblumi devient le point d'entrée universel pour explorer n'importe quelle source de données.
