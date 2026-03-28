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
inputDocuments:
  - "_bmad-output/planning-artifacts/product-brief-dblumi.md"
  - "_bmad-output/planning-artifacts/product-brief-dblumi-distillate.md"
workflowType: 'prd'
classification:
  projectType: web_app+developer_tool
  domain: developer_tooling
  complexity: medium
  projectContext: greenfield
---

# Product Requirements Document — dblumi

**Auteur :** Marc
**Date :** 2026-03-28
**Type :** Application web + Developer Tool — open source, self-hosted, greenfield

---

## Executive Summary

dblumi est un client de base de données web open source pour les développeurs et équipes techniques qui refusent de choisir entre un outil lourd et un outil mal fait. Il se connecte aux bases PostgreSQL et MySQL via une chaîne de connexion, offre une interface visuellement raffinée avec un éditeur SQL complet, et intègre un copilote IA (Claude) natif au schéma — déployable en moins de 90 secondes via Docker.

Le projet cible les équipes de 3 à 30 développeurs qui utilisent DBeaver (lent, complexe), CloudBeaver (hérite de la lourdeur DBeaver), ou des alternatives web bâclées. L'objectif : devenir une **référence communautaire** dans l'écosystème développeur — l'outil dont on parle, qu'on recommande, qu'on étoile par conviction. Modèle : open source (GitHub Sponsors) avec trajectoire vers un tier cloud managé.

### Ce qui rend dblumi spécial

Aucun outil existant ne réunit simultanément :

1. **Open source + web-natif** — déployable sans dépendre d'un vendeur
2. **UX de qualité production** — interface soignée à chaque détail, rare dans les outils open source de cette catégorie
3. **IA native au schéma** — le copilote Claude connaît la structure de la base connectée ; il génère du SQL juste *pour votre schéma*, pas du SQL générique
4. **Déploiement Docker first-class** — de `docker run` à la première requête en moins de 90 secondes

La **qualité d'exécution est le produit**. Trois moments "aha" définissent l'expérience : le démarrage en 90 secondes, la première requête IA contextualisée au schéma, et l'interface qui confirme que quelqu'un a pris soin de chaque détail.

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

| Domaine | Features |
|---|---|
| **Connexions** | PostgreSQL + MySQL, connexions globales (AES-256, write-once) + personnelles, groupes + RBAC |
| **Éditeur SQL** | DQL/DML/DDL complet, coloration syntaxique, autocomplétion schéma, guardrails sur requêtes destructives |
| **Schéma** | Navigation tables/colonnes/index/relations/clés étrangères |
| **IA** | Copilote Claude natif au schéma, NL→SQL, SQL→explication, streaming tokens, clé partagée + BYOK |
| **Bibliothèque** | Requêtes Favorites / Shared / Private, sauvegarde, recherche, exécution directe |
| **Auth & Équipe** | Login local + SSO OAuth (GitHub, Google), invitation email, groupes, RBAC (admin/éditeur/lecteur), déprovisionnement |
| **i18n** | Infrastructure de traduction + fichiers de langue externalisés (anglais par défaut, prêt contributions communautaires) |
| **API & MCP** | REST API documentée (OpenAPI), serveur MCP (`get_schema`, `execute_query`, `list_connections`, `get_saved_queries`) |
| **Déploiement** | SPA servie par le backend, `docker run` one-liner, `docker-compose.yml`, images linux/amd64 + linux/arm64 |
| **Démo** | Instance publique SQLite pré-peuplée sur Eodia, read-only, clé Claude côté serveur, sans signup |

### Growth Features — Phase 2 (Post-MVP)

- Support bases de données : SQLite, MongoDB, Oracle, Snowflake, Redis
- SSO enterprise : SAML, Okta, Azure AD
- Audit log : journal des requêtes exécutées (qui, quand, quoi)
- Détection de drift de schéma (alertes sur changements de structure)
- Liens de partage read-only de résultats de requêtes
- Templates one-click Coolify, Dokploy

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

Lucas est ingénieur backend depuis 5 ans. Il vient d'intégrer une startup de 12 personnes. Jour 1, il reçoit un email d'invitation dblumi. Il clique, se connecte via SSO GitHub en un clic. Il est dans l'interface — les connexions staging et production de l'équipe sont là. Sans avoir jamais demandé un mot de passe.

Il clique sur "staging". Le schéma s'affiche en moins de 2 secondes : 47 tables. Il ouvre le copilote : *"montre-moi les commandes passées des 7 derniers jours avec le nom du client"*. Le copilote génère le SQL exact avec les bonnes jointures. Les résultats arrivent. Il comprend le modèle de données en 10 minutes.

**Moment "aha" :** Le copilote connaissait ses tables. Ce n'était pas du SQL générique.

**Capabilities révélées :** invitation email, SSO OAuth, connexions partagées par groupe, navigation schéma, copilote natif au schéma, éditeur SQL, streaming résultats.

---

### Parcours 2 — Lucas, la requête qui fait peur *(cas limite — guardrail)*

Trois semaines plus tard. Lucas demande au copilote : *"supprime toutes les commandes annulées avant 2023"*. Le copilote génère le DELETE. Une modale apparaît : **"Cette requête va supprimer des données de façon irréversible. Lignes estimées : 4 823."** Le copilote affiche un warning rouge : *"Requête destructive — vérifiez que vous avez une sauvegarde."*

Lucas s'arrête. Il réalise qu'il allait exécuter ça sur staging avec des données de tests QA. Il annule. L'outil vient de lui éviter un incident.

**Capabilities révélées :** guardrails UX, confirmation modale, estimation lignes affectées, warning copilote sur requêtes destructives, message "accès refusé" explicite si droits insuffisants.

---

### Parcours 3 — Marie, la tech lead qui déploie et administre *(admin)*

Marie est CTO d'une équipe de 8 développeurs. Elle `docker compose up` sur le serveur de l'équipe. Ça démarre. Elle crée son compte admin, configure deux connexions globales (`production` read-only, `staging` lecture-écriture), crée deux groupes (`backend` et `frontend`), assigne ses 8 développeurs, invite chacun par email. Aucun n'a jamais vu les credentials de production.

Trois mois plus tard, un dev quitte l'équipe. Marie désactive son compte en un clic : accès révoqués immédiatement, requêtes partagées conservées pour l'équipe, requêtes privées archivées.

**Capabilities révélées :** config Docker, admin UI, connexions globales chiffrées write-once, groupes, RBAC, invitation email, déprovisionnement, archivage requêtes partagées.

---

### Parcours 4 — Alex, le visiteur de la démo *(conversion communautaire)*

Alex voit le Show HN de dblumi. Il clique "Live Demo". En 5 secondes, il est dans une interface connectée à une base SQLite pré-peuplée (e-commerce). Sans signup. Il tape : *"les 5 clients avec le plus de commandes"*. Le SQL arrive, les résultats aussi. Il réalise que l'IA connaît vraiment le schéma. Il étoile le repo. Il copie le `docker run` dans son terminal.

**Capabilities révélées :** instance démo publique (Eodia, SQLite, read-only), clé Claude côté serveur, zéro friction, `docker run` one-liner dans le README.

---

### Journey Requirements Summary

| Parcours | Capabilities principales requises |
|---|---|
| Lucas — happy path | Invitation email, SSO OAuth, connexions partagées, schéma, copilote natif, éditeur SQL |
| Lucas — guardrail | Détection requêtes destructives, modale confirmation, estimation lignes, warning IA |
| Marie — admin | Config Docker, admin UI, connexions globales chiffrées, groupes, RBAC, invitation, déprovisionnement |
| Alex — démo | Instance démo publique, SQLite pré-peuplé, zéro friction, `docker run` README |

---

## Functional Requirements

### Gestion des Connexions

- **FR01 :** L'administrateur peut créer une connexion globale à une base PostgreSQL ou MySQL via une chaîne de connexion standard
- **FR02 :** L'administrateur peut assigner une connexion globale à un ou plusieurs groupes avec des niveaux de permission distincts (lecture seule / lecture-écriture)
- **FR03 :** Les membres d'un groupe accèdent aux connexions globales assignées sans visualiser les credentials
- **FR04 :** Un utilisateur peut créer et gérer ses propres connexions personnelles, visibles uniquement par lui
- **FR05 :** Le système stocke toutes les chaînes de connexion chiffrées au repos, non récupérables en clair post-saisie
- **FR06 :** Un utilisateur peut tester la validité d'une connexion avant de la sauvegarder
- **FR07 :** L'administrateur peut supprimer ou désactiver une connexion globale

### Exploration du Schéma

- **FR08 :** Un utilisateur connecté peut explorer la structure complète de la base (tables, vues, colonnes, types, index, clés étrangères, relations)
- **FR09 :** Un utilisateur peut rechercher des tables ou colonnes par nom dans le schéma
- **FR10 :** Un utilisateur peut visualiser les statistiques d'une table (nombre de lignes estimé, taille)
- **FR11 :** Le système charge et affiche le schéma complet d'une base jusqu'à 500 tables en moins de 2 secondes

### Éditeur SQL

- **FR12 :** Un utilisateur peut écrire et exécuter des requêtes SQL (DQL, DML, DDL) dans un éditeur avec coloration syntaxique
- **FR13 :** L'éditeur propose une autocomplétion des noms de tables et colonnes issus du schéma connecté
- **FR14 :** Les résultats de requêtes s'affichent en streaming progressif dès réception des premières lignes
- **FR15 :** Le système affiche une confirmation modale avant l'exécution de toute requête destructive (DROP, TRUNCATE, DELETE sans WHERE, UPDATE sans WHERE)
- **FR16 :** Le système estime et affiche le nombre de lignes affectées avant confirmation d'une requête destructive
- **FR17 :** Un utilisateur peut exporter les résultats d'une requête (CSV, JSON)
- **FR18 :** Un utilisateur peut annuler une requête en cours d'exécution

### Copilote IA

- **FR19 :** Un utilisateur peut saisir une demande en langage naturel et recevoir une requête SQL générée, contextualisée au schéma de la base connectée
- **FR20 :** Un utilisateur peut soumettre une requête SQL et recevoir une explication en langage naturel
- **FR21 :** Le copilote signale explicitement toute requête destructive qu'il génère, avec un avertissement visible
- **FR22 :** Le copilote propose des suggestions contextuelles (jointures manquantes, optimisations, alternatives)
- **FR23 :** La réponse du copilote s'affiche en streaming de tokens en temps réel
- **FR24 :** L'administrateur peut configurer une clé API Claude partagée pour toute l'instance via variable d'environnement
- **FR25 :** Un utilisateur peut configurer sa propre clé API Claude (BYOK) qui prend le dessus sur la clé partagée

### Bibliothèque de Requêtes

- **FR26 :** Un utilisateur peut sauvegarder une requête SQL avec un nom et une description
- **FR27 :** Un utilisateur peut classer ses requêtes en Privées (visibles uniquement par lui) ou Partagées (visibles par toute l'équipe)
- **FR28 :** Un utilisateur peut marquer des requêtes en Favoris pour un accès rapide
- **FR29 :** Un utilisateur peut rechercher dans la bibliothèque par nom ou contenu SQL
- **FR30 :** Un utilisateur peut exécuter directement une requête depuis la bibliothèque
- **FR31 :** Lors du déprovisionnement d'un utilisateur, ses requêtes partagées restent accessibles à l'équipe

### Gestion d'Équipe & Accès

- **FR32 :** L'administrateur peut inviter des utilisateurs par email
- **FR33 :** Un utilisateur peut s'authentifier via login/mot de passe local ou SSO OAuth (GitHub, Google)
- **FR34 :** L'administrateur peut créer et gérer des groupes d'utilisateurs
- **FR35 :** L'administrateur peut assigner des utilisateurs à un ou plusieurs groupes
- **FR36 :** L'administrateur peut désactiver un compte utilisateur avec révocation immédiate de tous ses accès
- **FR37 :** Le système supporte trois rôles — administrateur, éditeur, lecteur — avec permissions distinctes sur l'exécution SQL et la gestion des connexions

### Intégrations & API

- **FR38 :** Le système expose une API REST documentée (OpenAPI) permettant l'exécution de requêtes, la consultation du schéma et l'accès à la bibliothèque via token d'authentification
- **FR39 :** Le système expose un serveur MCP permettant à des clients compatibles (Claude Desktop) d'accéder au schéma et d'exécuter des requêtes via `get_schema`, `execute_query`, `list_connections`, `get_saved_queries`

### Déploiement, Administration & i18n

- **FR40 :** Le système est déployable via une commande `docker run` unique avec configuration par variables d'environnement
- **FR41 :** L'administrateur peut accéder à un tableau de bord listant utilisateurs, groupes et connexions
- **FR42 :** Le système propose une instance de démonstration publique connectée à une base SQLite pré-peuplée, read-only, sans inscription requise
- **FR43 :** Le système intègre une infrastructure i18n avec fichiers de traduction externalisés permettant des contributions communautaires dès le lancement
- **FR44 :** La collecte de télémétrie est désactivée par défaut et requiert un opt-in explicite de l'opérateur

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

- **Chiffrement au repos :** chaînes de connexion DB chiffrées AES-256 ; clé fournie via `DBLUMI_ENCRYPTION_KEY`, jamais générée automatiquement
- **Proxy backend obligatoire :** connexions DB transitent exclusivement par le serveur ; credentials jamais exposés au navigateur client
- **Credentials non récupérables :** une connexion sauvegardée ne peut pas être affichée en clair, même par un administrateur
- **Sessions :** JWT avec expiration configurable ; révocation immédiate lors du déprovisionnement
- **Transport :** HTTPS délégué au reverse proxy de l'opérateur (Nginx, Caddy, Traefik)
- **Données de requêtes :** résultats d'exécution jamais persistés côté serveur ; bibliothèque stocke le SQL uniquement, pas les résultats
- **Intégrité des releases :** images Docker signées via cosign/sigstore
- **Télémétrie :** opt-in uniquement ; aucune donnée collectée par défaut
- **Chemin IA :** requêtes et schéma envoyés à l'API Anthropic — documenté explicitement ; BYOK recommandé pour données sensibles

### Accessibilité

- Conformité **WCAG 2.1 niveau AA**
- Navigation complète au clavier (éditeur SQL, navigation schéma, formulaires)
- Labels ARIA sur tous les composants interactifs
- Ratio de contraste minimum 4.5:1 (texte normal), 3:1 (éléments graphiques)
- Compatibilité avec les lecteurs d'écran courants (VoiceOver, NVDA)

### Fiabilité

- Instance Docker redémarre proprement sans intervention (graceful shutdown/restart)
- Erreurs de connexion DB retournent des messages clairs et actionnables — pas de stack trace exposée
- Données internes (utilisateurs, connexions, bibliothèque) persistées dans un volume Docker — aucune perte lors d'un redémarrage
- Timeout de requête configurable (défaut : 30s) avec annulation propre côté serveur

### Compatibilité

- **Navigateurs :** Chrome, Firefox, Safari, Edge — versions N et N-1
- **Container :** Docker Engine 20.10+, Docker Compose V2+
- **Architecture :** images Docker pour linux/amd64 et linux/arm64 (Apple Silicon)

---

## Domain-Specific Requirements

dblumi se positionne entre l'utilisateur et ses bases de données de production. La confiance est le produit — les exigences domaine découlent directement de ce principe.

### Confiance & Auditabilité (Open Source)

- Code source 100 % public — argument principal contre les objections sécurité des équipes
- Images Docker signées (cosign/sigstore) — intégrité des releases vérifiable
- Changelog et security disclosure policy dans le repo dès le lancement
- Pas de télémétrie par défaut — opt-in documenté et désactivable

### Confidentialité des Données

- Résultats de requêtes jamais persistés côté serveur (mémoire client uniquement)
- Bibliothèque de requêtes : SQL uniquement, pas les résultats
- Base SQLite de démo publique : aucune donnée personnelle

### Contraintes Techniques d'Infrastructure

- Support des chaînes de connexion standard (`postgresql://`, `mysql://`) avec SSL/TLS optionnel vers la DB
- Proxy backend — les credentials ne transitent jamais par le réseau côté client
- La clé de chiffrement est sous la responsabilité de l'opérateur — dblumi ne la génère pas

---

## Technical Architecture Requirements

### Architecture Frontend

- **Type :** SPA — build statique servi par le backend ; zéro runtime Node.js en production
- **Déploiement :** un seul container Docker incluant frontend et backend
- **Responsive :** optimisé desktop/laptop ; mobile non prioritaire en MVP

### Streaming & Temps Réel

- **Résultats de requêtes :** streaming progressif via Server-Sent Events ou WebSocket — lignes affichées au fur et à mesure
- **Copilote IA :** streaming des tokens Claude en temps réel dès réception
- **Indicateurs :** spinner + compteur de lignes reçues pendant le streaming

### API Publique & Intégrations

- **REST API :** authentification par token API, endpoints pour connexions/schéma/requêtes/bibliothèque, documentation OpenAPI/Swagger
- **Serveur MCP :** outils `get_schema`, `execute_query`, `list_connections`, `get_saved_queries` ; authentification via token API dblumi ; intégration Claude Desktop et clients MCP-compatibles

### Documentation Open Source

- README avec `docker run` one-liner, `docker-compose.yml` exemple, GIF de démo
- Documentation API REST (OpenAPI) et serveur MCP (tools, auth, exemples)
- Guide de contribution et security disclosure policy

---

## Innovation & Novel Patterns

### Innovations Identifiées

**1. IA native au schéma — pas un bolt-on**
Le copilote Claude a accès au schéma complet en temps réel à chaque interaction. Un utilisateur de ChatGPT pour SQL copie-colle son schéma. Un utilisateur de dblumi n'y pense pas. Aucun outil open source web-natif ne propose cette intégration aujourd'hui.

**2. La confiance comme architecture — BYOK + open source + proxy backend**
dblumi résout le paradoxe "outil web pour données sensibles" par des choix architecturaux (proxy backend, BYOK, code auditible) plutôt que par des déclarations marketing. Les équipes déploient sur leurs données de production sans compromis.

**3. La bibliothèque de requêtes partagées comme mémoire institutionnelle — en MVP**
Inclure la bibliothèque partagée dès le MVP positionne dblumi comme un outil qui construit la connaissance collective de l'équipe sur ses données — pas juste un outil individuel.

### Paysage Concurrentiel

| Outil | Lacune critique |
|---|---|
| Chat2DB | IA-first open source, mais sans Claude, UX inconsistante, pas web-natif pur — concurrent direct à surveiller |
| DataGrip | IA intégrée mais payant, bureau, bolt-on |
| CloudBeaver | Web + Docker mais hérite de la lourdeur DBeaver |
| Supabase SQL Editor | IA web-native mais lié à l'écosystème Supabase |

Fenêtre d'opportunité : aucun outil ne combine les 4 attributs dblumi simultanément en open source.

### Validation & Risques d'Innovation

| Signal de validation | Ce qu'il mesure |
|---|---|
| Étoiles GitHub à 30 jours | Désirabilité du positionnement |
| Ratio démo → déploiement | Réalité du "aha moment" |
| Requêtes IA par session | Adoption de l'innovation schema-native |
| Retours Show HN | Différenciation perçue |

| Risque | Mitigation |
|---|---|
| Concurrents copient l'approche | Moat = exécution + communauté open source |
| IA génère du SQL incorrect | Guardrails, feedback utilisateur, amélioration du prompt système |
| Équipes bloquent outils web sur prod | BYOK + open source + proxy = réponse architecturale |
| Coûts API Claude non contrôlés | BYOK encourage la clé personnelle |
