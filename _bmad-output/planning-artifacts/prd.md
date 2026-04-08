---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-e-01-discovery
  - step-e-02-review
  - step-e-03-edit
inputDocuments:
  - "_bmad-output/planning-artifacts/product-brief-dblumi.md"
  - "_bmad-output/planning-artifacts/product-brief-dblumi-distillate.md"
workflowType: 'prd'
classification:
  projectType: web_app+developer_tool
  domain: developer_tooling
  complexity: medium
  projectContext: brownfield
lastEdited: '2026-04-08'
editHistory:
  - date: '2026-03-28'
    changes: 'Ajout aperçu de données inline sur les tables avec édition et insertion de lignes (FR11a-FR11d), mise à jour Product Scope MVP et User Journey Lucas'
  - date: '2026-04-08'
    changes: 'Rétro-ingénierie complète du code existant : ajout Oracle, multi-provider AI, import/sync de données, collaboration temps réel (Yjs), historique de versions, ERD, command palette, DB Users, Keycloak OIDC. Reclassification des features non encore implémentées (GitHub/Google SSO, invitation email, MCP, démo SQLite) en Phase 2.'
---

# Product Requirements Document — dblumi

**Auteur :** Marc
**Date :** 2026-04-08
**Type :** Application web + Developer Tool — open source, self-hosted, brownfield

---

## Executive Summary

dblumi est un client de base de données web open source pour les développeurs et équipes techniques qui refusent de choisir entre un outil lourd et un outil mal fait. Il se connecte aux bases PostgreSQL, MySQL et Oracle via une chaîne de connexion standard, offre une interface visuellement raffinée avec un éditeur SQL complet, une collaboration temps réel, et intègre un copilote IA natif au schéma — déployable en moins de 90 secondes via Docker.

Le projet cible les équipes de 3 à 30 développeurs qui utilisent DBeaver (lent, complexe), CloudBeaver (hérite de la lourdeur DBeaver), ou des alternatives web bâclées. L'objectif : devenir une **référence communautaire** dans l'écosystème développeur — l'outil dont on parle, qu'on recommande, qu'on étoile par conviction. Modèle : open source (GitHub Sponsors) avec trajectoire vers un tier cloud managé.

### Ce qui rend dblumi spécial

Aucun outil existant ne réunit simultanément :

1. **Open source + web-natif** — déployable sans dépendre d'un vendeur
2. **UX de qualité production** — interface soignée à chaque détail, rare dans les outils open source de cette catégorie
3. **IA native au schéma + multi-provider** — le copilote (Claude, GPT-4, Azure OpenAI) connaît la structure de la base connectée ; il génère du SQL juste *pour votre schéma*, pas du SQL générique
4. **Collaboration temps réel** — édition simultanée, curseurs partagés, chat par query — le premier client SQL collaboratif en open source
5. **Déploiement Docker first-class** — de `docker run` à la première requête en moins de 90 secondes

La **qualité d'exécution est le produit**. Quatre moments "aha" définissent l'expérience : le démarrage en 90 secondes, la première requête IA contextualisée au schéma, l'édition simultanée avec un collègue, et l'interface qui confirme que quelqu'un a pris soin de chaque détail.

---

## Success Criteria

### User Success

- Un développeur passe de `docker run` à sa première requête en **moins de 90 secondes**
- Le copilote génère du SQL correct et contextualisé au schéma à la première tentative dans **≥ 80 % des cas** pour les requêtes courantes (SELECT, JOIN, filtre, agrégation)
- Un admin configure une connexion globale et l'assigne à un groupe en **moins de 2 minutes** sans documentation
- Un nouveau membre d'équipe accède aux connexions partagées de son groupe sans demander de credentials
- Les requêtes de la bibliothèque partagée sont retrouvables et réutilisables en **moins de 3 clics**

### Business Success

- **30 jours post-lancement :** 1 000 étoiles GitHub — seuil de validation de la désirabilité
- **6 mois :** 5 000 étoiles GitHub — déclencheur Phase 2 (cloud managé)
- Instances Docker actives mesurées via telemetry opt-in
- Premiers sponsors GitHub dans les 60 jours post-lancement
- **Phase 2 :** MRR croissant, rétention équipe à 30/90 jours, requêtes IA par session comme proxy d'engagement

**Stratégie de lancement :** Show HN + Product Hunt le même jour, démo en ligne (SQLite, Eodia) pour conversion sans déploiement, README avec GIF de démo et `docker run` en une ligne.

### Measurable Outcomes

| Métrique | Cible MVP | Cible 6 mois |
|---|---|---|
| Étoiles GitHub | 1 000 / 30j | 5 000 |
| Temps démarrage (docker run → 1ère requête) | < 90s | < 90s |
| Chargement schéma (500 tables) | < 2s | < 2s |
| Premiers résultats streaming | < 500ms | < 500ms |
| Précision IA (requêtes courantes) | ≥ 80 % | ≥ 85 % |

---

## Product Scope

### MVP — Phase 1 (Experience MVP)

Philosophie : chaque feature est finie à 100 % ou absente. La qualité prime sur la quantité.

| Domaine | Features | Statut |
|---|---|---|
| **Connexions** | PostgreSQL + MySQL + Oracle, connexions globales (AES-256, write-once) + personnelles, groupes + RBAC, partage par utilisateur ou groupe | ✅ Implémenté |
| **Éditeur SQL** | DQL/DML/DDL complet, coloration syntaxique, autocomplétion schéma, guardrails sur requêtes destructives (5 niveaux), export CSV/JSON | ✅ Implémenté |
| **Schéma** | Navigation tables/colonnes/index/relations/clés étrangères, aperçu des données inline, édition et insertion de lignes, ERD (React Flow), DB Users management | ✅ Implémenté |
| **IA** | Copilote multi-provider (Anthropic Claude, OpenAI, Azure OpenAI) natif au schéma, NL→SQL, SQL→explication, streaming tokens, clé partagée + BYOK | ✅ Implémenté |
| **Bibliothèque** | Requêtes Partagées / Privées, sauvegarde, recherche, exécution directe, historique de versions avec diff, partage granulaire (users + groups + collaborative flag) | ✅ Implémenté |
| **Collaboration** | Édition simultanée temps réel (Yjs CRDT), curseurs et présence utilisateurs, chat collaboratif par query avec historique persisté | ✅ Implémenté |
| **Import / Sync** | Import de données (CSV, JSON, Excel, XML, TSV) avec mapping IA, sync inter-bases avec progression streaming | ✅ Implémenté |
| **Auth & Équipe** | Login local, SSO Keycloak OIDC, groupes, RBAC (admin/éditeur/lecteur), changement de mot de passe, reset par email | ✅ Implémenté |
| **i18n** | Infrastructure de traduction + fichiers de langue externalisés (français + anglais) | ✅ Implémenté |
| **Admin** | Tableau de bord utilisateurs + groupes, gestion des rôles, déprovisionnement | ✅ Implémenté |
| **API documentée** | OpenAPI/Swagger UI exposée, endpoints REST authentifiés | ✅ Implémenté |
| **Déploiement** | SPA servie par le backend, `docker run` one-liner, `docker-compose.yml`, images linux/amd64 + linux/arm64 | ✅ Implémenté |
| **SSO OAuth GitHub / Google** | OAuth2 GitHub et Google — scaffolding présent, implémentation incomplète | ⚠️ Partiel |
| **Invitation email** | Inviter un utilisateur par email (flux d'onboarding) — reset password implémenté, invitation non | ⚠️ Partiel |
| **Démo publique** | Instance publique SQLite pré-peuplée sur Eodia, read-only, sans signup | ❌ À faire |
| **Serveur MCP** | `get_schema`, `execute_query`, `list_connections`, `get_saved_queries` pour Claude Desktop | ❌ À faire |
| **Télémétrie opt-in** | Collecte anonyme opt-in des instances Docker actives | ❌ À faire |

### Growth Features — Phase 2 (Post-MVP)

- Support bases de données : SQLite, MongoDB, Snowflake, Redis
- SSO enterprise : SAML, Okta, Azure AD
- Audit log : journal des requêtes exécutées (qui, quand, quoi)
- Détection de drift de schéma (alertes sur changements de structure)
- Liens de partage read-only de résultats de requêtes
- Templates one-click Coolify, Dokploy
- Annulation de requête en cours d'exécution (côté serveur)

### Vision — Phase 3 (Expansion)

- dblumi Cloud : version cloud managée (hébergement, backups, SSO, support)
- Support étendu : SQL Server, BigQuery, connecteurs communautaires (architecture plugin)
- Copilote avancé : détection d'anomalies, optimisation de requêtes, documentation de schéma auto-générée
- Multi-workspace pour agences et consultants

### Risk Mitigation

| Risque | Mitigation |
|---|---|
| Scope trop large pour solo dev | Lancer le core, itérer rapidement post-lancement |
| IA génère du SQL incorrect | Guardrails, feedback inline, amélioration continue du prompt système |
| Adoption lente post-lancement | Démo publique + Show HN + README soigné comme funnel principal |
| Coûts Claude à l'échelle | BYOK recommandé par défaut ; clé partagée optionnelle à la discrétion de l'opérateur |

---

## User Journeys

### Parcours 1 — Lucas, le développeur qui rejoint une nouvelle équipe *(chemin heureux)*

Lucas est ingénieur backend depuis 5 ans. Il vient d'intégrer une startup de 12 personnes. Jour 1, il reçoit un lien d'accès. Il se connecte via Keycloak SSO en un clic. Il est dans l'interface — les connexions staging et production de l'équipe sont là. Sans avoir jamais demandé un mot de passe.

Il clique sur "staging". Le schéma s'affiche en moins de 2 secondes : 47 tables. Il clique sur la table `orders` — les premières lignes apparaissent immédiatement. Il ouvre le copilote : *"montre-moi les commandes passées des 7 derniers jours avec le nom du client"*. Le copilote génère le SQL exact avec les bonnes jointures. Il réalise que le copilote connaissait ses tables. Son senior lui envoie une invitation de collaboration sur la query qu'il vient de créer — ils éditent ensemble, les curseurs visibles en temps réel.

**Moment "aha" :** Le copilote connaissait ses tables. Ce n'était pas du SQL générique. Et la collaboration temps réel avec son collègue.

**Capabilities révélées :** SSO Keycloak, connexions partagées par groupe, navigation schéma, copilote natif au schéma, éditeur SQL, streaming résultats, collaboration Yjs, chat collaboratif.

---

### Parcours 2 — Lucas, la requête qui fait peur *(cas limite — guardrail)*

Trois semaines plus tard. Lucas demande au copilote : *"supprime toutes les commandes annulées avant 2023"*. Le copilote génère le DELETE. Une modale apparaît : **"Cette requête va supprimer des données de façon irréversible."** Le copilote affiche un warning rouge : *"Requête destructive — vérifiez que vous avez une sauvegarde."*

Lucas s'arrête. Il réalise qu'il allait exécuter ça sur staging avec des données de tests QA. Il annule.

**Capabilities révélées :** guardrails UX (5 niveaux), confirmation modale, warning copilote sur requêtes destructives.

---

### Parcours 3 — Marie, la tech lead qui déploie et administre *(admin)*

Marie est CTO d'une équipe de 8 développeurs. Elle `docker compose up` sur le serveur de l'équipe. Ça démarre. Elle crée son compte admin, configure deux connexions globales (`production` read-only, `staging` lecture-écriture), crée deux groupes (`backend` et `frontend`), assigne ses 8 développeurs. Aucun n'a jamais vu les credentials de production.

Elle configure ensuite le provider Keycloak de l'entreprise — les développeurs se connecteront via leur compte d'entreprise habituel.

Trois mois plus tard, un dev quitte l'équipe. Marie désactive son compte en un clic : accès révoqués immédiatement, requêtes partagées conservées pour l'équipe.

**Capabilities révélées :** config Docker, admin UI, connexions globales chiffrées write-once, groupes, RBAC, Keycloak OIDC, déprovisionnement.

---

### Parcours 4 — Alex, le visiteur de la démo *(conversion communautaire)*

Alex voit le Show HN de dblumi. Il clique "Live Demo". En 5 secondes, il est dans une interface connectée à une base SQLite pré-peuplée (e-commerce). Sans signup. Il tape : *"les 5 clients avec le plus de commandes"*. Le SQL arrive, les résultats aussi. Il réalise que l'IA connaît vraiment le schéma. Il étoile le repo. Il copie le `docker run` dans son terminal.

**Capabilities révélées :** instance démo publique (Eodia, SQLite, read-only), clé Claude côté serveur, zéro friction, `docker run` one-liner dans le README.

> **Note :** Ce parcours correspond à une feature encore à implémenter (démo publique SQLite).

---

### Journey Requirements Summary

| Parcours | Capabilities principales requises | Statut |
|---|---|---|
| Lucas — happy path | SSO Keycloak, connexions partagées, schéma, copilote natif, éditeur SQL, collaboration | ✅ Implémenté |
| Lucas — guardrail | Détection requêtes destructives, modale confirmation, warning IA | ✅ Implémenté |
| Marie — admin | Config Docker, admin UI, connexions globales chiffrées, groupes, RBAC, Keycloak | ✅ Implémenté |
| Alex — démo | Instance démo publique, SQLite pré-peuplé, zéro friction | ❌ À faire |

---

## Functional Requirements

### Gestion des Connexions

- **FR01 :** L'administrateur peut créer une connexion globale à une base PostgreSQL, MySQL ou Oracle via une chaîne de connexion standard
- **FR02 :** L'administrateur peut assigner une connexion globale à un ou plusieurs groupes avec des niveaux de permission distincts (lecture seule / lecture-écriture)
- **FR03 :** Les membres d'un groupe accèdent aux connexions globales assignées sans visualiser les credentials
- **FR04 :** Un utilisateur peut créer et gérer ses propres connexions personnelles, visibles uniquement par lui
- **FR05 :** Le système stocke toutes les chaînes de connexion chiffrées au repos (AES-256-GCM), non récupérables en clair post-saisie
- **FR06 :** Un utilisateur peut tester la validité d'une connexion avant de la sauvegarder (latence + version serveur)
- **FR07 :** L'administrateur peut supprimer ou désactiver une connexion globale
- **FR07b :** Un utilisateur peut partager directement une connexion personnelle à un autre utilisateur ou groupe

### Exploration du Schéma

- **FR08 :** Un utilisateur connecté peut explorer la structure complète de la base (tables, vues, colonnes, types, index, clés étrangères, relations)
- **FR09 :** Un utilisateur peut rechercher des tables ou colonnes par nom dans le schéma
- **FR10 :** Un utilisateur peut visualiser les statistiques d'une base (nombre de tables, taille totale, nombre de lignes estimé)
- **FR11 :** Le système charge et affiche le schéma complet d'une base jusqu'à 500 tables en moins de 2 secondes
- **FR11a :** Un utilisateur peut ouvrir l'aperçu des données d'une table : les premières lignes s'affichent avec pagination et tri par colonne
- **FR11b :** Un utilisateur peut éditer une ligne existante directement depuis l'aperçu : les valeurs sont modifiables en inline et la sauvegarde génère un UPDATE ciblé sur la clé primaire
- **FR11c :** Un utilisateur peut insérer une nouvelle ligne depuis l'aperçu via un formulaire généré automatiquement à partir du schéma de la table (types, nullabilité, valeurs par défaut)
- **FR11d :** Toute modification ou insertion depuis l'aperçu déclenche une confirmation modale avant exécution, avec affichage du SQL généré ; les utilisateurs en rôle lecteur n'ont accès qu'à la lecture
- **FR11e :** Un utilisateur peut visualiser un diagramme ERD (entité-relation) des tables de la base avec leurs relations via clés étrangères

### Éditeur SQL

- **FR12 :** Un utilisateur peut écrire et exécuter des requêtes SQL (DQL, DML, DDL) dans un éditeur avec coloration syntaxique
- **FR13 :** L'éditeur propose une autocomplétion des noms de tables et colonnes issus du schéma connecté
- **FR14 :** Les résultats de requêtes s'affichent en streaming progressif dès réception des premières lignes, avec tri multi-niveaux, filtres par colonne et export CSV/JSON
- **FR15 :** Le système affiche une confirmation modale avant l'exécution de toute requête destructive (DROP, TRUNCATE, DELETE sans WHERE, UPDATE sans WHERE), avec 5 niveaux de sévérité
- **FR16 :** Un utilisateur peut formater automatiquement le SQL de l'éditeur
- **FR17 :** Un utilisateur peut exporter les résultats d'une requête (CSV, JSON)
- **FR17b :** Un utilisateur peut gérer plusieurs queries dans des onglets, réorganisables par drag-and-drop, avec un raccourci clavier pour ouvrir/fermer un onglet

### Copilote IA

- **FR18 :** Un utilisateur peut saisir une demande en langage naturel et recevoir une requête SQL générée, contextualisée au schéma de la base connectée
- **FR19 :** Un utilisateur peut soumettre une requête SQL et recevoir une explication en langage naturel
- **FR20 :** Le copilote signale explicitement toute requête destructive qu'il génère, avec un avertissement visible
- **FR21 :** La réponse du copilote s'affiche en streaming de tokens en temps réel
- **FR22 :** L'administrateur peut configurer le provider IA actif (Anthropic, OpenAI, Azure OpenAI) et la clé API associée via variables d'environnement
- **FR23 :** Un utilisateur peut configurer sa propre clé API (BYOK) pour le provider Anthropic, qui prend le dessus sur la clé partagée

### Bibliothèque de Requêtes

- **FR24 :** Un utilisateur peut sauvegarder une requête SQL avec un nom, une description et un dossier
- **FR25 :** Un utilisateur peut classer ses requêtes en Privées (visibles uniquement par lui) ou les partager à des utilisateurs ou groupes spécifiques
- **FR26 :** Un utilisateur peut marquer une requête comme collaborative lors du partage, permettant l'édition simultanée par les destinataires
- **FR27 :** Un utilisateur peut rechercher dans la bibliothèque par nom ou contenu SQL
- **FR28 :** Un utilisateur peut exécuter directement une requête depuis la bibliothèque
- **FR29 :** Chaque sauvegarde d'une requête crée automatiquement une version horodatée ; l'utilisateur peut consulter l'historique et visualiser les diffs entre versions
- **FR30 :** Lors du déprovisionnement d'un utilisateur, ses requêtes partagées restent accessibles aux destinataires

### Collaboration Temps Réel

- **FR31 :** Plusieurs utilisateurs peuvent éditer simultanément la même requête SQL en temps réel (CRDT Yjs), avec affichage des curseurs et sélections de chaque participant
- **FR32 :** Un utilisateur peut voir les avatars et couleurs des collaborateurs présents sur une requête
- **FR33 :** Un utilisateur peut envoyer et recevoir des messages dans un chat lié à la requête, avec historique persisté et chargement infini

### Import & Sync de Données

- **FR34 :** Un utilisateur peut importer des données depuis un fichier (CSV, JSON, Excel, XML, TSV) vers une table existante ou nouvelle, avec détection automatique des types de colonnes
- **FR35 :** Le copilote peut assister le mapping des colonnes du fichier source vers les colonnes de la table cible lors d'un import
- **FR36 :** Un utilisateur peut synchroniser les données d'une table entre deux connexions (source → cible), avec options pour inclure la structure et/ou les données
- **FR37 :** L'import et la synchronisation affichent une progression en streaming (lignes traitées, phases, erreurs)

### Gestion des Utilisateurs de Base de Données

- **FR38 :** Un administrateur peut lister, créer, modifier et supprimer les utilisateurs de la base de données connectée (PostgreSQL / MySQL)
- **FR39 :** Un administrateur peut configurer les privilèges serveur et table d'un utilisateur de base de données

### Gestion d'Équipe & Accès

- **FR40 :** L'administrateur peut créer et gérer des groupes d'utilisateurs
- **FR41 :** L'administrateur peut assigner des utilisateurs à un ou plusieurs groupes
- **FR42 :** L'administrateur peut désactiver un compte utilisateur avec révocation immédiate de tous ses accès
- **FR43 :** Le système supporte trois rôles — administrateur, éditeur, lecteur — avec permissions distinctes sur l'exécution SQL et la gestion des connexions
- **FR44 :** Un utilisateur peut s'authentifier via login/mot de passe local ou SSO Keycloak OIDC
- **FR45 :** Un utilisateur peut réinitialiser son mot de passe via un lien envoyé par email
- **FR46 :** *(Phase 1 — partiel)* L'administrateur peut inviter des utilisateurs par email
- **FR47 :** *(Phase 1 — partiel)* Un utilisateur peut s'authentifier via SSO OAuth GitHub ou Google

### Intégrations & API

- **FR48 :** Le système expose une API REST documentée (OpenAPI/Swagger) permettant l'exécution de requêtes et la consultation du schéma
- **FR49 :** *(Phase 1 — à faire)* Le système expose un serveur MCP permettant à des clients compatibles (Claude Desktop) d'accéder au schéma et d'exécuter des requêtes

### Déploiement, Administration & i18n

- **FR50 :** Le système est déployable via une commande `docker run` unique avec configuration par variables d'environnement
- **FR51 :** L'administrateur peut accéder à un tableau de bord listant utilisateurs, groupes et connexions avec gestion complète
- **FR52 :** *(Phase 1 — à faire)* Le système propose une instance de démonstration publique connectée à une base SQLite pré-peuplée, read-only, sans inscription requise
- **FR53 :** Le système intègre une infrastructure i18n avec fichiers de traduction externalisés en français et anglais
- **FR54 :** *(Phase 1 — à faire)* La collecte de télémétrie est désactivée par défaut et requiert un opt-in explicite de l'opérateur

---

## Non-Functional Requirements

### Performance

| Critère | Cible | Contexte |
|---|---|---|
| Chargement initial de l'application | < 3s | Bundle JS < 500 KB gzippé, lazy loading |
| Chargement du schéma | < 2s | Base jusqu'à 500 tables/vues |
| Premiers résultats en streaming | < 500ms | Après réponse de la base de données |
| Premier token IA reçu | < 1s | Après envoi de la requête au copilote |
| Temps de réponse UI (actions locales) | < 100ms | Navigation, ouverture de panneaux |

### Sécurité

- **Chiffrement au repos :** chaînes de connexion DB et clés API utilisateur chiffrées AES-256-GCM ; clé fournie via `DBLUMI_ENCRYPTION_KEY`, jamais générée automatiquement
- **Proxy backend obligatoire :** connexions DB transitent exclusivement par le serveur ; credentials jamais exposés au navigateur client
- **Credentials non récupérables :** une connexion sauvegardée ne peut pas être affichée en clair, même par un administrateur
- **Sessions :** JWT avec expiration configurable ; révocation immédiate lors du déprovisionnement (table `revokedTokens`)
- **Transport :** HTTPS délégué au reverse proxy de l'opérateur (Nginx, Caddy, Traefik)
- **Données de requêtes :** résultats d'exécution jamais persistés côté serveur ; bibliothèque stocke le SQL uniquement, pas les résultats
- **Télémétrie :** opt-in uniquement ; aucune donnée collectée par défaut
- **Chemin IA :** requêtes et schéma envoyés au provider IA configuré — documenté explicitement ; BYOK recommandé pour données sensibles

### Accessibilité

- Navigation complète au clavier (éditeur SQL, navigation schéma, formulaires)
- Labels ARIA sur tous les composants interactifs (Radix UI)
- Ratio de contraste minimum 4.5:1 (texte normal)
- Compatibilité avec les navigateurs modernes (Chrome, Firefox, Safari, Edge — N et N-1)

### Fiabilité

- Instance Docker redémarre proprement sans intervention (graceful shutdown/restart)
- Erreurs de connexion DB retournent des messages clairs et actionnables — pas de stack trace exposée (RFC 7807 Problem Details)
- Données internes (utilisateurs, connexions, bibliothèque) persistées dans un volume Docker SQLite — aucune perte lors d'un redémarrage
- Connection pooling par driver (pg.Pool, mysql2.Pool, oracledb.Pool) avec cycle de vie géré

### Compatibilité

- **Navigateurs :** Chrome, Firefox, Safari, Edge — versions N et N-1
- **Bases de données :** PostgreSQL (toutes versions modernes), MySQL 5.7+, Oracle 10g R2+
- **Container :** Docker Engine 20.10+, Docker Compose V2+
- **Architecture :** images Docker pour linux/amd64 et linux/arm64 (Apple Silicon)

---

## Domain-Specific Requirements

dblumi se positionne entre l'utilisateur et ses bases de données de production. La confiance est le produit — les exigences domaine découlent directement de ce principe.

### Confiance & Auditabilité (Open Source)

- Code source 100 % public — argument principal contre les objections sécurité des équipes
- Changelog et security disclosure policy dans le repo dès le lancement
- Pas de télémétrie par défaut — opt-in documenté et désactivable

### Confidentialité des Données

- Résultats de requêtes jamais persistés côté serveur (mémoire client uniquement)
- Bibliothèque de requêtes : SQL uniquement, pas les résultats
- Clés API utilisateur chiffrées au repos (BYOK sécurisé)

### Contraintes Techniques d'Infrastructure

- Support des chaînes de connexion standard (`postgresql://`, `mysql://`, Oracle TNS/Easy Connect) avec SSL/TLS optionnel
- Proxy backend — les credentials ne transitent jamais par le réseau côté client
- La clé de chiffrement est sous la responsabilité de l'opérateur — dblumi ne la génère pas

---

## Technical Architecture Requirements

### Architecture Frontend

- **Type :** SPA — build statique servi par le backend ; zéro runtime Node.js en production
- **Déploiement :** un seul container Docker incluant frontend et backend
- **Responsive :** optimisé desktop/laptop ; mobile non prioritaire en MVP

### Streaming & Temps Réel

- **Résultats de requêtes :** streaming progressif via Server-Sent Events (SSE) — lignes affichées par batch de 100
- **Copilote IA :** streaming des tokens en temps réel dès réception (SSE)
- **Collaboration :** WebSocket Yjs — synchronisation CRDT des documents, protocole awareness (curseurs/présence), chat via Y.Array
- **Import/Sync :** progression streaming via SSE (phases, lignes traitées, erreurs)

### API Publique & Intégrations

- **REST API :** authentification par JWT cookie ou token API, endpoints pour connexions/schéma/requêtes/bibliothèque, documentation OpenAPI/Swagger UI accessible sur `/api/docs`
- **Serveur MCP :** *(à implémenter)* outils `get_schema`, `execute_query`, `list_connections`, `get_saved_queries` ; authentification via token API dblumi

### Documentation Open Source

- README avec `docker run` one-liner, `docker-compose.yml` exemple, GIF de démo
- Documentation API REST (OpenAPI) accessible via Swagger UI embarquée
- Guide de contribution et security disclosure policy

---

## Innovation & Novel Patterns

### Innovations Identifiées

**1. IA native au schéma — pas un bolt-on**
Le copilote a accès au schéma complet en temps réel à chaque interaction, avec support multi-provider (Claude, GPT-4, Azure OpenAI). Un utilisateur de ChatGPT pour SQL copie-colle son schéma. Un utilisateur de dblumi n'y pense pas.

**2. La confiance comme architecture — BYOK + open source + proxy backend**
dblumi résout le paradoxe "outil web pour données sensibles" par des choix architecturaux (proxy backend, BYOK, code auditible) plutôt que par des déclarations marketing.

**3. Le premier client SQL collaboratif open source**
La collaboration temps réel (Yjs CRDT, curseurs partagés, chat par query) positionne dblumi dans une catégorie à part dans l'outillage SQL open source.

**4. La bibliothèque de requêtes comme mémoire institutionnelle**
Versions historisées, diffs, partage granulaire (users + groups + collaborative) — la bibliothèque construit la connaissance collective de l'équipe sur ses données.

### Paysage Concurrentiel

| Outil | Lacune critique |
|---|---|
| Chat2DB | IA-first open source, mais sans Claude natif, UX inconsistante — concurrent direct à surveiller |
| DataGrip | IA intégrée mais payant, bureau, bolt-on |
| CloudBeaver | Web + Docker mais hérite de la lourdeur DBeaver |
| Supabase SQL Editor | IA web-native mais lié à l'écosystème Supabase |

Fenêtre d'opportunité : aucun outil ne combine les 5 attributs dblumi simultanément en open source (multi-base, multi-IA, collab temps réel, BYOK, UX soignée).

### Validation & Risques d'Innovation

| Signal de validation | Ce qu'il mesure |
|---|---|
| Étoiles GitHub à 30 jours | Désirabilité du positionnement |
| Ratio démo → déploiement | Réalité du "aha moment" |
| Requêtes IA par session | Adoption de l'innovation schema-native |
| Sessions collaboratives actives | Adoption de la collaboration temps réel |
| Retours Show HN | Différenciation perçue |

| Risque | Mitigation |
|---|---|
| Concurrents copient l'approche | Moat = exécution + communauté open source |
| IA génère du SQL incorrect | Guardrails, feedback utilisateur, amélioration du prompt système |
| Équipes bloquent outils web sur prod | BYOK + open source + proxy = réponse architecturale |
| Coûts API IA non contrôlés | BYOK encourage la clé personnelle, multi-provider permet de switcher |
