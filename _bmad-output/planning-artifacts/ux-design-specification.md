---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-03-core-experience
  - step-04-emotional-response
  - step-05-inspiration
  - step-06-design-system
  - step-07-defining-experience
  - step-08-visual-foundation
  - step-09-design-directions
  - step-10-user-journeys
  - step-11-component-strategy
  - step-12-ux-patterns
  - step-13-responsive-accessibility
  - step-14-complete
inputDocuments:
  - prd.md
  - architecture.md
  - product-brief-dblumi.md
---

# UX Design Specification — dblumi

**Auteur :** Marc
**Date :** 2026-03-28

---

<!-- Le contenu UX sera ajouté séquentiellement à travers les étapes du workflow collaboratif -->

---

## Executive Summary

### Project Vision

dblumi est le premier client de base de données web qui respecte vraiment les développeurs : open source, déployable en 90 secondes via Docker, avec un copilote IA (Claude) natif au schéma et une interface soignée à chaque détail. L'ambition UX : que chaque interaction soit fluide, évidente, et belle — là où les concurrents (DBeaver, CloudBeaver) ont renoncé au soin.

### Target Users

**Lucas — le développeur en équipe (primaire)**
Backend/fullstack, 2–10 ans d'expérience, équipe 3–30 personnes. PostgreSQL ou MySQL. Frustré par DBeaver et l'absence d'outil web décent. Ce qui le convainc : une interface dont il n'a pas honte, et une IA qui comprend vraiment son schéma.

**Marie — la tech lead / admin (secondaire)**
Configure l'instance, gère les accès. Valorise la sécurité, la simplicité d'administration, la fiabilité. Elle veut que ça marche sans documentation.

**Alex — le visiteur démo (tertiaire)**
30 secondes pour être convaincu sur HN. Zéro friction, zéro signup, résultats immédiats.

### Key Design Challenges

1. **Densité informationnelle** — layout schéma / éditeur / résultats / copilote sans effet "cockpit d'avion"
2. **Copilote non intrusif** — accessible en un geste, invisible pour qui n'en a pas besoin
3. **Guardrails qui protègent sans irriter** — confirmation destructive efficace mais non punitive
4. **Onboarding 90 secondes** — de `docker run` à première requête IA en moins de 90 secondes, sans documentation

### Design Opportunities

1. **Dark mode soigné first** — dark mode par défaut, typographie monospace premium, contrastes WCAG AA — rare dans la catégorie
2. **L'éditeur comme scène centrale** — SQL au centre, tout le reste au service
3. **Copilote comme compagnon discret** — drawer latéral contextuel, pas popup intrusive

---

## Core User Experience

### Defining Experience

L'action fondamentale de dblumi est le flow connexion → requête → résultat, enrichi d'une variante distinctive : idée en langage naturel → SQL contextualisé → résultat. C'est le "aha moment" qui différencie dblumi de tout concurrent.

### Platform Strategy

Web desktop-first, souris + clavier, navigateurs modernes (N/N-1). Mobile non prioritaire en MVP. Offline : non par design (proxy backend).

**Layout de référence — Supabase SQL Editor adapté :**
- Panneau schéma resizable (gauche)
- Éditeur SQL + résultats splitpane (centre, dominant)
- Copilote drawer (droite, fermé par défaut, `Cmd+K`)

```
┌─────────────────────────────────────────────────────────┐
│  [dblumi]  [connexion active ▾]              [profil]   │
├──────────────┬──────────────────────────────┬───────────┤
│              │                              │           │
│  Schéma      │    Éditeur SQL               │  Copilote │
│  (panneau    │    (CodeMirror 6)            │  (drawer  │
│   gauche,    │                              │   droit,  │
│   resizable) ├──────────────────────────────┤   Cmd+K)  │
│              │    Résultats (streaming)     │           │
│              │    + barre statut            │           │
└──────────────┴──────────────────────────────┴───────────┘
```

### Effortless Interactions

- Changer de connexion : un clic, sans rechargement
- Exécuter une requête : `Cmd+Enter`, universel
- Ouvrir le copilote : `Cmd+K`, drawer non intrusif
- Chercher dans le schéma : recherche instantanée inline
- Sauvegarder une requête : depuis l'éditeur, sans quitter le contexte

### Critical Success Moments

| Moment | Critère de succès |
|---|---|
| Premier lancement | Setup < 5 étapes, schéma affiché, prêt en < 90s |
| Premier NL→SQL | La requête utilise les vrais noms de tables du schéma |
| Requête destructive | Modale rapide, estimation visible, annulation évidente |
| Invitation email | Un clic, SSO, dans l'interface — < 60 secondes |
| Déprovisionnement | Révocation immédiate, confirmée dans l'admin |

### Experience Principles

1. **L'éditeur est souverain** — tout le reste est au service du SQL
2. **Le copilote arrive quand on l'appelle** — `Cmd+K`, invisible sinon
3. **Le résultat avant le formulaire** — zéro friction avant de voir quelque chose
4. **Les erreurs parlent humain** — messages actionnables, jamais de stack trace
5. **La densité sans le chaos** — beaucoup d'info visible, hiérarchie claire, dark mode soigné

---

## Desired Emotional Response

### Primary Emotional Goals

**Émotion primaire : la compétence.**
*"Je suis efficace. Je maîtrise ma base de données. Cet outil me rend meilleur."*
Pas de la joie superficielle — de la compétence ressentie. C'est l'émotion qui fait qu'un développeur recommande un outil à ses collègues.

### Emotional Journey Mapping

| Moment | Émotion cible |
|---|---|
| Découverte (Show HN / README) | Curiosité → intérêt → *"ça a l'air sérieux"* |
| Premier `docker run` | Légère anxiété → soulagement (ça marche, c'est rapide) |
| Premier schéma affiché | Satisfaction → confiance |
| Premier NL→SQL avec son schéma | **Surprise positive → émerveillement** *"il connaît mes tables !"* |
| Requête destructive bloquée | Sécurité → gratitude |
| Bibliothèque partagée de l'équipe | Appartenance → fierté |
| Retour quotidien | Confort → dépendance douce |

### Micro-Emotions

**Émotions secondaires à cultiver :**
- **Confiance** — exécuter des requêtes sur la prod sans peur d'une fausse manipulation
- **Clarté** — comprendre sa base en quelques secondes, sans se perdre dans l'interface
- **Appartenance** — l'équipe partage le même outil, les requêtes, une mémoire collective

**Émotions à éviter absolument :**
- **Anxiété** — "je ne sais pas ce que ça va faire sur la prod"
- **Frustration** — "pourquoi c'est si compliqué juste pour faire un SELECT ?"
- **Méfiance** — "est-ce que cet outil IA va envoyer mes données quelque part ?"

### Design Implications

- **Compétence → feedback immédiat** : résultats qui streament, compteur de lignes, statut de requête — chaque action réussie confirme la maîtrise
- **Confiance → guardrails visibles mais discrets** : la modale destructive rassure, elle ne punit pas
- **Clarté → hiérarchie visuelle forte** : un seul centre d'attention à la fois, dark mode soigné
- **Méfiance évitée → BYOK mis en avant dès l'onboarding** : "vos données ne passent pas par nos serveurs"
- **Émerveillement → le copilote contextualise toujours** : jamais de SQL générique, toujours avec les vrais noms de tables

### Emotional Design Principles

1. **Confirmer avant de surprendre** — chaque action produit un retour immédiat et lisible
2. **Protéger sans punir** — les guardrails sont des filets de sécurité, pas des obstacles
3. **La transparence crée la confiance** — BYOK, open source, proxy backend — explicites dès le début
4. **L'émerveillement vient du contexte** — le copilote qui connaît ton schéma est plus impressionnant que 100 features

---

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**Supabase SQL Editor** — référence principale layout
Layout 3 colonnes, dark mode natif, résultats inline, schéma navigable. Point d'amélioration : IA générique (pas native au schéma), bibliothèque de requêtes moins soignée.

**Linear** — référence devtools UX
Keyboard-first, `Cmd+K` pour tout, transitions fluides, optimistic UI, design system très cohérent. Enseigne que vitesse perçue = confiance.

**Raycast** — référence productivity
Palette de commandes universelle, recherche fuzzy instantanée, context menus riches, densité sans chaos. Enseigne que tout doit être accessible en < 2 frappes.

### Transferable UX Patterns

**À adopter :**
- Layout 3 colonnes resizable (Supabase) → schéma / éditeur+résultats / copilote
- `Cmd+K` Command Menu universel (Linear/Raycast) → connexions, requêtes sauvegardées, tables, actions admin — tout accessible en < 2 frappes
- Context Menu riche et contextuel (Raycast/Linear) :
  - Sur **table dans le schéma** : "SELECT * LIMIT 100", "Copier le nom", "Voir la structure", "Demander au copilote"
  - Sur **ligne de résultats** : "Filtrer par cette valeur", "Copier la cellule", "Copier la ligne JSON"
  - Sur **requête sauvegardée** : "Exécuter", "Modifier", "Dupliquer", "Changer la visibilité"
  - Sur **colonne dans l'éditeur** : "Aller à la définition dans le schéma"
- Optimistic UI (Linear) → sauvegardes et actions sans attendre la réponse serveur
- Dark mode first avec tokens CSS (Linear) → cohérence visuelle totale
- Streaming avec compteur progressif (Supabase) → lignes reçues en temps réel
- Sidebar collapsible (VS Code) → schéma rétractable pour maximiser l'éditeur

**À adapter :**
- Autocomplétion VS Code → CodeMirror 6 avec schéma connecté comme source
- Drawer copilote → plus discret que GitHub Copilot, uniquement sur `Cmd+K`

### Anti-Patterns to Avoid

| Anti-pattern | Éviter parce que |
|---|---|
| Modal wizard multi-étapes (DBeaver) | Trop de friction pour une connexion |
| Sidebar non resizable (CloudBeaver) | Frustrant sur petits écrans |
| IA dans champ séparé de l'éditeur (Chat2DB) | Casse le flow contextuel |
| Popup onboarding au premier lancement | Interrompt la découverte naturelle |
| Résultats dans onglet séparé (TablePlus) | Perd le contexte de la requête |
| Confirmation sur toutes les actions | Fatigue — réserver aux requêtes destructives |

### Design Inspiration Strategy

**Adopter :** layout Supabase + keyboard-first Linear + palette et context menus Raycast
**Adapter :** autocomplétion VS Code → CodeMirror schéma-aware
**Éviter :** tout ce qui crée de la friction avant de voir un résultat
**Différencier :** copilote schéma-aware + command menu qui connaît les connexions/requêtes/tables en temps réel

---

## Design System Foundation

### Design System Choice

**shadcn/ui** (Radix UI + Tailwind CSS v4) — système themeable, composants owned (pas une dépendance npm), TypeScript natif.

### Rationale for Selection

- Radix UI en dessous → WCAG AA natif, accessibilité clavier complète
- CSS variables → dark mode first trivial, tokens bien structurés
- Composants critiques disponibles : `Command` (Cmd+K), `ContextMenu`, `ResizablePanelGroup`, `Sheet` (copilote), `Dialog` (guardrails), `Table`, `Tabs`
- Possession totale des composants → modifications sans contrainte
- Compatible Tailwind v4 et React 19

### Composants Critiques

| Composant shadcn/ui | Usage dblumi |
|---|---|
| `<Command>` | Command Menu `Cmd+K` — connexions, requêtes sauvegardées, tables |
| `<ContextMenu>` | Clic droit sur tables schéma, lignes résultats, requêtes sauvegardées |
| `<ResizablePanelGroup>` | Layout 3 colonnes : schéma / éditeur+résultats / copilote |
| `<Sheet>` | Drawer copilote IA (droite, fermé par défaut) |
| `<Dialog>` | Modale confirmation requêtes destructives |
| `<Table>` + TanStack Virtual | Résultats de requêtes (grands datasets virtualisés) |
| `<Tabs>` | Onglets SQL multiples simultanés |

### Customization Strategy

**Dark mode first** — thème dark par défaut, clair en option
**Typographie monospace premium** — JetBrains Mono pour l'éditeur SQL et les résultats — le détail qui fait la différence

**Design tokens :**
- `--font-mono` : JetBrains Mono / Geist Mono
- `--font-sans` : Inter / Geist
- Accent color : violet/indigo (spectre devtools premium — à finaliser au design)
- Thème dark : backgrounds profonds (#0a0a0a range), contrastes WCAG AA respectés

---

## Defining Core Experience

### Defining Experience

**"L'idée → le SQL juste → le résultat, sans quitter le contexte."**

L'expérience définissante de dblumi est la transformation d'une intention en langage naturel en SQL contextualisé au schéma réel, exécuté en streaming, sans changer d'outil ni copier-coller son schéma.

### User Mental Model

Les développeurs opèrent en deux modes :
- **Exploration** : "qu'est-ce qu'il y a dans cette base ?"
- **Production** : "j'ai besoin de cette donnée précise, maintenant"

L'innovation dblumi : le copilote natif au schéma abolit la friction entre les deux modes. L'utilisateur ne quitte jamais son contexte.

**Frustrations actuelles :**
- Copier-coller le schéma dans ChatGPT à chaque question
- SQL générique qui rate les vrais noms de tables
- Changer d'outil pour obtenir de l'aide

### Success Criteria

- Le SQL généré utilise les vrais noms de tables et colonnes du schéma connecté
- Premier token visible < 1 seconde après envoi
- "Insérer dans l'éditeur" en un clic — zéro copier-coller
- Premiers résultats streaming < 500ms après exécution
- L'utilisateur ne quitte jamais l'interface

### Novel UX Patterns

**Combinaison de patterns établis + innovation dans la continuité :**
- Éditeur SQL (connu) + drawer contextuel (connu) + schéma en contexte IA (nouveau)
- Pas de nouveau paradigme à apprendre — couche magique sur un flow connu
- La nouveauté vient du résultat (SQL juste), pas de l'interaction (drawer latéral)

### Experience Mechanics

**1. Initiation :**
- `Cmd+K` → palette commandes (avec option copilote)
- Clic droit sur une table → "Demander au copilote"
- Champ copilote ouvert → saisie directe

**2. Interaction :**
- Saisie en langage naturel
- Schéma complet injecté en contexte (invisible pour l'utilisateur)
- Tokens Claude streamés en temps réel avec coloration syntaxique

**3. Feedback :**
- Streaming visible token par token
- Badge warning rouge si requête destructive détectée
- Bouton "Insérer dans l'éditeur" — un clic

**4. Completion :**
- `Cmd+Enter` → résultats en streaming + compteur de lignes en temps réel
- Notification discrète "Sauvegarder dans la bibliothèque ?" après succès

---

## Visual Design Foundation

### Color System

**Philosophie :** "Luminescent Dark" — outil sombre et précis, accent vert électrique évoquant le terminal et la lumière dans les données. Aucun concurrent dans la catégorie ne fait ça.

| Token | Valeur | Usage |
|---|---|---|
| `--background` | `#121314` | Background principal (éditeur, résultats) |
| `--surface` | `#171717` | Panels latéraux, menubar, copilote |
| `--surface-raised` | `#1C1C1F` | Toolbars, headers, éléments surélevés |
| `--surface-overlay` | `#27272A` | Hover states, cartes, dropdowns |
| `--border` | `#222323` | Bordures — séparation subtile |
| `--border-strong` | `#3F3F46` | Bordures accentuées (focus, sélection) |
| `--foreground` | `#FAFAFA` | Texte principal |
| `--muted` | `#A1A1AA` | Texte secondaire |
| `--muted-2` | `#71717A` | Placeholders, metadata |
| `--primary` | `#41cd2a` | Accent principal — vert électrique |
| `--primary-hover` | `#36b022` | States hover |
| `--primary-subtle` | `#41cd2a15` | Backgrounds actifs, sélections |
| `--success` | `#10B981` | Requête réussie, connexion OK |
| `--warning` | `#F59E0B` | DELETE sans WHERE, avertissements |
| `--destructive` | `#EF4444` | DROP, TRUNCATE — rouge explicite |

**Usages accent `#41cd2a` :**
- Connexion active (point indicateur)
- Focus rings clavier
- Curseur clignotant éditeur SQL
- Boutons d'action primaires
- Indicateur streaming actif

### Typography System

| Usage | Police | Taille | Weight |
|---|---|---|---|
| UI corps | Geist | 14px / 1.6 | 400 |
| Labels, badges | Geist | 13px / 1.5 | 400–500 |
| Titres section | Geist | 16px / 1.5 | 600 |
| Éditeur SQL | JetBrains Mono | 14px / 1.6 | 400 |
| Résultats | JetBrains Mono | 13px / 1.5 | 400 |
| Metadata, timestamps | Geist | 11px / 1.5 | 400 |

### Spacing & Layout Foundation

**Base unit : 4px**
- Intérieur composants : 8–12px
- Entre composants : 12–16px
- Padding panels : 16–24px

**Dimensions layout :**
- Sidebar schéma : 260px défaut (min 200px, max 400px, resizable)
- Drawer copilote : 380px, full-height
- Éditeur SQL : hauteur libre, min 120px
- Résultats : hauteur libre, min 200px

### Accessibility Considerations

- Texte principal : `#FAFAFA` / `#121314` → > 16:1 ✅ (AAA)
- Accent sur fond : `#41cd2a` / `#121314` → 8.3:1 ✅ (AAA)
- Texte secondaire : `#A1A1AA` / `#121314` → 7.2:1 ✅ (AAA)
- Focus rings : `#41cd2a` outline 2px — visible sur tous les backgrounds
- Taille minimum : 14px pour tout contenu interactif — 12px uniquement pour badges et metadata

---

## Design Direction Decision

### Directions explorées

Trois directions ont été créées et itérées :

- **Direction A — "Terminal Pro"** : Dense, monospace partout, énergie terminal — pour les développeurs qui vivent dans le CLI
- **Direction B — "Refined Dark"** : Équilibré, respirant, modern devtool — inspire confiance et élégance discrète
- **Direction C — "Luminescent"** : Accent vert utilisé de façon expressive, copilote toujours visible, identité forte

### Direction choisie

**Base Direction B "Refined Dark"**, enrichie d'éléments de C et inspirée des patterns Navicat/shadcn.

**Éléments retenus :**

- **Sidebar shadcn** : header connexion avec icône DB typée (🐘 PostgreSQL, 🐬 MySQL) + env pill, sections collapsibles (Favoris / Schéma / Requêtes), arbre Tables / Vues / Fonctions / Saved Queries avec colonnes dépliables, footer utilisateur (avatar + nom + email)
- **Copilote panel** : permanent à droite (style C), context pills des tables actives, conversation NL→SQL avec "Insérer dans l'éditeur" / "Mettre à jour l'éditeur"
- **Topbar** : logo db**lumi** glow vert, sélecteur connexion avec pill env `prod`
- **Menubar** : barre classique compacte (Fichier, Édition, Affichage, Connexions, Requêtes, Outils, Aide) + `⌘K`
- **Command menu** (⌘K) : actions globales (Nouvelle connexion, Nouvelle requête, Sauvegarder), navigation connexions/tables
- **Context menu** (clic droit table) : Demander au copilote ✦, SELECT LIMIT 100, Voir la structure, Copier le nom, Statistiques, Ajouter aux favoris, TRUNCATE (danger)
- **Font UI** : Geist — **Font code** : JetBrains Mono

### Design Rationale

1. **Direction B** offre l'équilibre professionnel et la lisibilité — ni trop dense (A) ni trop expressif (C)
2. **Le copilote de C** donne le "aha moment" visible dès le premier écran sans drawer caché
3. **L'arbre Navicat/shadcn** est le pattern familier pour les devs venant de DBeaver/Navicat/DataGrip
4. **Le menubar** assure la découvrabilité des actions clés (nouvelle connexion, etc.) sans encombrer la topbar
5. **Geist** apporte modernité et cohérence avec l'écosystème shadcn/Vercel que dblumi utilise

### Implementation Approach

**Color system final :**

| Zone | Token | Couleur |
|---|---|---|
| Centre (éditeur, résultats) | `--bg-root` | `#121314` |
| Sidebar, menubar, copilote | `--bg-surface` | `#171717` |
| Toolbars, headers | `--bg-raised` | `#1C1C1F` |
| Hover, dropdowns | `--bg-overlay` | `#27272A` |
| Bordures | `--border` | `#222323` |
| Texte principal | `--foreground` | `#FAFAFA` |
| Texte secondaire | `--muted` | `#A1A1AA` |
| Accent | `--primary` | `#41cd2a` |

**Typography :** 14px minimum pour tout contenu interactif (sidebar items, copilote, éditeur tabs, résultats) — 12px pour badges et metadata uniquement. Menubar conservé à 12px (compact volontaire).

**Mockup de référence :** `_bmad-output/planning-artifacts/ux-design-directions.html`

---

## User Journey Flows

### Journey 1 — Onboarding développeur (Lucas, happy path)

**Objectif :** De `docker run` à la première requête IA contextualisée en moins de 90 secondes.

```mermaid
flowchart TD
    A([🚀 docker run dblumi]) --> B[Accès http://localhost:3000]
    B --> C{Première visite ?}
    C -- Oui --> D[Écran setup admin\nnom + email + mot de passe]
    C -- Non --> E[Page de connexion]
    D --> F[Instance configurée]
    F --> G[Dashboard vide\n+ prompt 'Ajouter une connexion']
    E --> H[Connexion réussie]
    H --> I{Connexions disponibles ?}
    I -- Non --> G
    I -- Oui --> J[Liste des connexions\n+ connexions équipe visibles]
    G --> K[Formulaire nouvelle connexion\nstring PostgreSQL / MySQL]
    K --> L{Test connexion}
    L -- Échec --> M[Erreur claire + conseil\nex: port inaccessible]
    M --> K
    L -- Succès --> N[Connexion sauvegardée ✓]
    N --> J
    J --> O[Clic connexion → Sidebar schéma chargé\n< 2s pour 500 tables]
    O --> P[Copilote ouvert\nContext pills: tables détectées]
    P --> Q[Saisie NL: 'montre-moi\nles commandes des 7 derniers jours']
    Q --> R[SQL généré + streaming tokens]
    R --> S[↗ Insérer dans l'éditeur]
    S --> T[▶ Run → Résultats streaming]
    T --> U([✅ AHA MOMENT\nL'IA connaît mon schéma])

    style A fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style U fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style M fill:#EF444420,stroke:#EF4444,color:#FAFAFA
```

**Moments clés de l'interface :**
- Le schéma sidebar se peuple visuellement (animation progressive)
- Les context pills du copilote affichent les tables détectées automatiquement
- Le streaming SQL tokens crée l'impression "l'IA réfléchit"
- Le bouton "↗ Insérer" est le seul CTA visible après la réponse IA

---

### Journey 2 — Flux principal quotidien : idée → SQL → résultat

**Objectif :** Réduire le temps entre une question métier et ses données. Le flow de base répété 10x/jour.

```mermaid
flowchart LR
    A([💭 Idée / question métier]) --> B{Via copilote\nou SQL direct ?}

    B -- Copilote --> C[Saisie langage naturel\ndans le panel copilote]
    C --> D[Streaming réponse IA\navec SQL généré]
    D --> E{Requête destructive ?}
    E -- Oui --> F[⚠️ Warning rouge copilote\n'Requête destructive détectée']
    E -- Non --> G[↗ Insérer dans l'éditeur]
    F --> G
    G --> H[SQL dans l'éditeur\ncurseur positionné]

    B -- SQL direct --> H

    H --> I{Modifier le SQL ?}
    I -- Oui --> J[Édition + autocomplétion\nnoms tables/colonnes]
    J --> K[▶ Run Ctrl+Entrée]
    I -- Non --> K

    K --> L{Requête destructive\ndétectée ?}
    L -- Oui --> M[Modale guardrail\nestimation lignes affectées]
    M --> N{Confirmer ?}
    N -- Non --> H
    N -- Oui --> O[Exécution + streaming résultats]
    L -- Non --> O

    O --> P{Succès ?}
    P -- Erreur SQL --> Q[Message erreur clair\n+ suggestion correction]
    Q --> H
    P -- Timeout --> R[Option annuler FR18\nou relancer]
    P -- Résultats --> S[Tableau résultats\nstreaming progressif]

    S --> T{Action suivante ?}
    T -- Sauvegarder --> U[💾 Nommer + Privée/Partagée]
    T -- Exporter --> V[↓ Export CSV/JSON]
    T -- Itérer --> C
    T -- Done --> W([✅ Question répondue])

    style A fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style W fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style F fill:#EF444420,stroke:#EF4444,color:#FAFAFA
    style M fill:#EF444420,stroke:#EF4444,color:#FAFAFA
    style Q fill:#f59e0b20,stroke:#f59e0b,color:#FAFAFA
```

**Principes de fluidité :**
- Raccourci `Ctrl+Entrée` / `⌘+Entrée` pour Run sans quitter le clavier
- Autocomplétion active dès 2 caractères (tables, colonnes, keywords)
- Résultats streaming : premières lignes < 500ms — pas d'écran blanc
- Sauvegarde rapide : `⌘S` → dialog non-bloquant avec nom pré-rempli

---

### Journey 3 — Guardrail requête destructive (Lucas, cas limite)

**Objectif :** Intercepter les requêtes dangereuses sans punir le développeur expérimenté.

```mermaid
flowchart TD
    A([Lucas: 'supprime toutes les commandes\nannulées avant 2023']) --> B[Copilote génère DELETE]
    B --> C[⚠️ Badge rouge dans la réponse copilote\n'Requête destructive — vérifiez vos sauvegardes']
    C --> D[↗ Insérer dans l'éditeur]
    D --> E[SQL DELETE visible dans l'éditeur\navec highlight rouge sur DELETE]
    E --> F[▶ Run]
    F --> G[Analyse pré-exécution\nDELETE sans... WHERE = ALL ?]
    G --> H[Modale de confirmation]
    H --> I[Affichage:\n• Requête complète\n• ⚠️ Lignes estimées: 4 823\n• Type: DELETE irréversible\n• Connexion: STAGING]
    I --> J{Décision Lucas}
    J -- Annuler --> K[Retour éditeur\naucune modification]
    J -- 'Je comprends,\nexécuter' --> L{Connexion prod ?}
    L -- Staging/Dev --> M[Exécution + résultat\n'4 823 lignes supprimées']
    L -- Production --> N[Double confirmation\n'Vous êtes sur PRODUCTION'\nSaisir: CONFIRMER']
    N --> O{Saisie correcte ?}
    O -- Non --> I
    O -- Oui --> P[Exécution production]

    style A fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style C fill:#EF444420,stroke:#EF4444,color:#FAFAFA
    style H fill:#EF444420,stroke:#EF4444,color:#FAFAFA
    style N fill:#EF444420,stroke:#EF4444,color:#FAFAFA
    style K fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
```

**Règles de déclenchement des guardrails :**
- `DELETE` sans `WHERE` → modale systématique
- `DROP TABLE/DATABASE` → modale systématique
- `TRUNCATE` → modale systématique
- `UPDATE` sans `WHERE` → modale systématique
- Connexion prod + requête destructive → double confirmation textuelle

---

### Journey 4 — Admin setup équipe (Marie)

**Objectif :** De `docker compose up` à toute l'équipe opérationnelle, sans que personne ne voie un credential de production.

```mermaid
flowchart TD
    A([docker compose up]) --> B{Premier démarrage ?}
    B -- Oui --> C[Wizard setup admin\nnom + email + mot de passe]
    C --> D[Dashboard admin\n⚙️ Configuration initiale]
    B -- Non --> E[Login admin]
    E --> D

    D --> F[+ Nouvelle connexion globale]
    F --> G[Formulaire: string + label + read-only/RW]
    G --> H{Test connexion}
    H -- Échec --> I[Erreur diagnostique\nex: SSL requis, timeout]
    I --> G
    H -- Succès --> J[Connexion chiffrée AES-256\nnon récupérable post-save]

    J --> K[+ Nouveau groupe]
    K --> L[Nom groupe + assignation connexion\n+ niveau permission R/RW]
    L --> M[Inviter membres par email]
    M --> N[Emails envoyés\nlien d'invitation 48h]

    N --> O[Lucas reçoit email]
    O --> P{Auth}
    P -- SSO GitHub --> Q[Compte créé\nconnexions équipe visibles]
    P -- Email/mdp --> Q

    Q --> R([✅ Équipe opérationnelle\nzéro credential partagé])

    subgraph Déprovisionnement
        S([Dev quitte l'équipe]) --> T[Admin: désactiver compte]
        T --> U[Accès révoqués immédiatement\nJWT invalidé]
        U --> V[Requêtes partagées conservées\nRequêtes privées archivées]
    end

    style A fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style R fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style I fill:#f59e0b20,stroke:#f59e0b,color:#FAFAFA
    style U fill:#EF444420,stroke:#EF4444,color:#FAFAFA
```

---

### Journey 5 — Visiteur démo (Alex, conversion communautaire)

**Objectif :** De "Show HN" à l'étoile GitHub en moins de 60 secondes. Zéro friction, zéro signup.

```mermaid
flowchart TD
    A([Alex voit dblumi sur Show HN]) --> B[Clic 'Live Demo']
    B --> C[Interface dblumi\nconnectée SQLite e-commerce\n< 3s sans login]
    C --> D[Sidebar: schéma pré-chargé\ncustomers, orders, products...]
    D --> E[Panel copilote ouvert\nmessage de bienvenue + exemple]
    E --> F[Alex tape: 'les 5 clients\navec le plus de commandes']
    F --> G[Streaming SQL généré\navec les vraies tables du schéma]
    G --> H[↗ Insérer → ▶ Run]
    H --> I[Résultats réels\nnoms, commandes, montants]
    I --> J([💡 'L'IA connaissait vraiment\nle schéma — pas du générique'])
    J --> K{Action}
    K -- Étoile --> L[⭐ GitHub star]
    K -- Déployer --> M[README → docker run\ncopié dans le terminal]
    K -- Partager --> N[Lien partagé sur Slack/X]

    style A fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style J fill:#41cd2a20,stroke:#41cd2a,color:#FAFAFA
    style C fill:#41cd2a15,stroke:#41cd2a50,color:#FAFAFA
```

**Contraintes démo (FR42) :**
- Instance SQLite e-commerce pré-peuplée, read-only (mutations bloquées côté serveur)
- Clé Claude côté serveur — pas de BYOK requis pour tester
- `DEMO_MODE=true` env var — banner discret "Instance de démo — données fictives"
- Aucun signup, aucun cookie de tracking sans opt-in

---

### Journey Patterns

**Pattern de navigation universelle — ⌘K Command Menu**
- Accessible depuis n'importe quel état de l'application
- Sections : Actions rapides / Connexions / Tables / Requêtes sauvegardées
- Raccourci clavier primaire pour switcher de connexion sans la souris

**Pattern de feedback contextuel — Clic droit / Context Menu**
- Sur une table dans la sidebar : ouvre le contexte table (SELECT LIMIT, copilote, favoris, TRUNCATE)
- Sur une cellule de résultat : copier valeur, filtrer sur cette valeur

**Pattern de persistance légère — Tabs d'éditeur**
- Chaque requête ouvre un tab nommé (nom du fichier ou `query_N.sql`)
- Tabs persistent entre les sessions (état local)
- `⌘T` nouvelle requête, `⌘W` fermer tab

**Pattern de confirmation progressive**
- Actions légères (sauvegarder, exporter) : feedback inline toast, pas de modale
- Actions moyennes (supprimer une requête sauvegardée) : modale simple Annuler / Confirmer
- Actions destructives SQL (DROP, TRUNCATE, DELETE sans WHERE) : modale avec estimation lignes
- Actions destructives sur prod : double confirmation textuelle

---

### Flow Optimization Principles

1. **Clavier-first** — chaque action critique a un raccourci, aucun flux ne requiert la souris
2. **Zéro écran blanc** — streaming partout (résultats, tokens IA, chargement schéma progressif)
3. **Contexte persistant** — le copilote garde le contexte de la conversation dans la session
4. **Erreurs actionnables** — chaque message d'erreur contient une suggestion de correction
5. **Guardrails non-punitifs** — la confirmation destructive ne bloque pas, elle informe ; un dev expérimenté passe en 2 clics
6. **Demo-first** — le mode démo est une vitrine produit, pas un sous-produit ; il doit être parfait

---

## Component Strategy

### Composants shadcn/ui (design system — Radix UI + Tailwind v4)

Couverture des besoins dblumi par shadcn/ui :

| Composant shadcn | Usage dans dblumi |
|---|---|
| `Command` | ⌘K Command Menu — navigation et actions globales |
| `ContextMenu` | Clic droit sur table sidebar / cellule résultat |
| `ResizablePanelGroup` | Split sidebar / éditeur+résultats / copilote |
| `Sheet` | Drawer copilote en variant latéral |
| `Dialog` | Modale guardrail requêtes destructives |
| `AlertDialog` | Double confirmation sur connexion production |
| `Tabs` | Tabs éditeur SQL, onglets Results/Chart |
| `ScrollArea` | Sidebar tree, résultats table, messages copilote |
| `Separator` | Divisions sidebar, séparateurs menus |
| `Badge` | Env pills prod/staging, row counts, types colonnes |
| `Button` | Run, Export, actions primaires et secondaires |
| `Input` / `Textarea` | Recherche sidebar, input copilote NL |
| `Sonner` (Toast) | Feedback : sauvegarde requête, connexion réussie |
| `Collapsible` | Sections Tables / Vues / Fonctions / Saved Queries |
| `DropdownMenu` | Menu connexions, actions utilisateur, Export ▾ |
| `Avatar` | Footer user sidebar |
| `Tooltip` | Raccourcis clavier, labels colonnes tronquées |
| `Skeleton` | Loading states schéma, résultats |

### Composants custom (gaps non couverts par shadcn)

#### SqlEditor

**Purpose :** Éditeur SQL complet avec coloration syntaxique, autocomplétion native au schéma, numéros de ligne et raccourcis clavier.
**Base :** CodeMirror 6 (`@codemirror/lang-sql` + `@codemirror/autocomplete`)
**Anatomy :**
- Zone numéros de ligne (gutter)
- Surface d'édition avec highlight actif
- Toolbar : tabs de fichiers, bouton Run, actions secondaires (Format, Explain)

**States :**
- `idle` — curseur actif, autocomplétion dormante
- `autocomplete` — dropdown suggestions tables/colonnes/keywords
- `running` — curseur désactivé, spinner dans le bouton Run
- `error` — highlight rouge sur la ligne incriminée + message inline
- `destructive-warning` — highlight orange sur DELETE/DROP/TRUNCATE

**Variants :** taille normale (splitter) / compact (requête sauvegardée read-only preview)
**Accessibilité :** focus ring `#41cd2a`, raccourcis `Ctrl+Espace` (autocomplete), `Ctrl+Enter` (run), `Ctrl+/` (comment)

---

#### ResultsTable

**Purpose :** Tableau de résultats SQL virtualisé, supportant le streaming progressif de milliers de lignes sans freeze UI.
**Base :** TanStack Virtual + TanStack Table
**Anatomy :**
- Header sticky avec noms de colonnes + tri (↑↓) + resize handle
- Body virtualisé (seules les lignes visibles sont dans le DOM)
- Footer : nb lignes, temps d'exécution, bouton Export
- Barre d'état streaming : "Réception... X lignes" pendant le flux

**States :**
- `empty` — état vide avec message "Aucun résultat"
- `streaming` — lignes qui s'ajoutent progressivement, compteur animé
- `complete` — tableau final, tri activé
- `error` — message d'erreur SQL clair + suggestion

**Variants :** mode tableau (défaut) / mode chart (TBD phase 2)
**Accessibilité :** navigation clavier entre cellules, sélection copiable, `aria-live` sur le compteur de streaming

---

#### SchemaSidebar

**Purpose :** Arbre hiérarchique connexion → base de données → Tables/Vues/Fonctions/Saved Queries avec colonnes dépliables. Remplace shadcn `Collapsible` (trop limité pour l'imbrication multi-niveaux et les états de chargement).
**Anatomy :**
- Header : sélecteur connexion active (icon DB type, nom, env pill, chevron ⇅)
- Barre de recherche avec raccourci `/`
- Sections : **Favoris** / **Schéma** (Tables, Vues, Fonctions) / **Requêtes** (Partagées, Privées) / **Autres connexions**
- Nodes : chevron animé, icône typée, label, badge row count, env badge
- Sub-nodes colonnes : nom (mono), type (mono discret), badge PK/FK/unique
- Footer : avatar utilisateur + nom + email + chevron ⇅

**States :**
- Nœud `collapsed` / `expanded` / `loading` (skeleton)
- Nœud `active` (fond `--bg-overlay`, texte primary, badge accent)
- Connexion `connected` (dot vert) / `disconnected` (dot gris)

**Accessibilité :** navigation clavier flèches ↑↓→← pour expand/collapse, `aria-expanded`, `aria-selected`

---

#### CopilotPanel

**Purpose :** Interface de chat IA contextuelle, affichant les réponses en streaming de tokens, avec context pills des tables actives et actions d'insertion dans l'éditeur.
**Anatomy :**
- Header : icône ✦, titre "Copilote", badge modèle (claude-sonnet-4), bouton fermer
- Context pills : tables actuellement visibles dans l'éditeur (auto-détectées)
- Zone messages : scroll auto vers le bas, bulles user/AI avec avatars
- Bloc code SQL dans les réponses : fond `--bg-root`, coloration syntaxique
- Actions inline : `↗ Insérer dans l'éditeur` / `↗ Mettre à jour l'éditeur`
- Input : textarea auto-resize, bouton envoi `↑`

**States :**
- `idle` — input actif, placeholder
- `streaming` — tokens affichés progressivement, cursor clignotant, bouton envoi désactivé
- `error` — message d'erreur API avec retry
- `destructive-response` — badge ⚠️ rouge sur le bloc SQL généré

**Variants :** panel permanent (défaut) / drawer Sheet fermé (si utilisateur veut plus d'espace)
**Accessibilité :** `aria-live="polite"` sur la zone messages, focus automatique sur l'input après insertion

---

#### GuardrailModal

**Purpose :** Dialogue de confirmation avant exécution d'une requête destructive — non-punitif, informatif, rapide à confirmer pour un développeur expérimenté.
**Base :** shadcn `Dialog` / `AlertDialog` étendu avec données contextuelles
**Anatomy :**
- Header : icône ⚠️ + titre "Requête destructive"
- Corps : requête SQL complète (read-only, coloration), estimation lignes affectées, type d'opération, connexion cible
- Warning spécifique production : encadré rouge, champ de saisie "Saisissez CONFIRMER"
- Footer : bouton "Annuler" (primaire visuellement) + bouton "Exécuter" (destructive, `--danger`)

**States :**
- `standard` — DELETE/TRUNCATE/DROP sur non-prod → 2 boutons
- `production` — même opération sur connexion prod → champ texte requis
- `loading` — estimation en cours (requête COUNT préalable)

**Accessibilité :** focus initial sur "Annuler", `aria-describedby` sur l'estimation, Escape = annuler

---

### Stratégie d'implémentation

**Principe directeur :** shadcn/ui fournit les primitives Radix accessibles et les tokens de style — les composants custom sont construits au-dessus avec les mêmes tokens CSS (`--bg-*`, `--border`, `--primary`, etc.) pour garantir la cohérence.

**Approche :** composants co-localisés par feature (`src/web/src/features/editor/SqlEditor.tsx`, etc.) — pas de "component library" centralisée en MVP.

### Roadmap d'implémentation

**Phase 1 — Critique (MVP bloquant)**
- `SqlEditor` — bloque tout le flux éditeur
- `ResultsTable` — bloque l'affichage des résultats
- `SchemaSidebar` — bloque la navigation schéma
- `GuardrailModal` — bloque les guardrails (FR15/FR16)

**Phase 2 — Important (MVP complet)**
- `CopilotPanel` — bloque le flux NL→SQL (FR19–FR23)
- Intégration `Command` (⌘K) avec données réelles
- Intégration `ContextMenu` sur les nœuds sidebar

**Phase 3 — Amélioration continue**
- Mode Chart dans ResultsTable (TanStack Charts)
- Variant drawer fermé pour CopilotPanel
- Animations de chargement schéma (skeleton progressif)

---

## UX Consistency Patterns

### Hiérarchie des boutons

| Niveau | Usage | Apparence |
|---|---|---|
| **Primaire** | `Run`, `Confirmer connexion`, `Sauvegarder` | Fond `#41cd2a`, texte `#080A08`, font-weight 700 |
| **Secondaire** | `Export`, `Annuler`, `Voir la structure` | Ghost — border `--border-default`, texte `--text-secondary` |
| **Destructif** | `Exécuter (TRUNCATE/DROP)` dans GuardrailModal | Fond `--danger` `#EF4444`, texte blanc |
| **Icône seule** | `↑` send copilote, `×` fermer panel | 26×26px, background transparent, hover `--bg-raised` |

Règle : jamais plus d'un bouton primaire par zone visible. Le bouton destructif n'apparaît que dans les modales de confirmation, jamais en action directe.

### Feedback Patterns

**Toast (Sonner) — actions légères réversibles ou non-critiques**
- Déclencheurs : requête sauvegardée, connexion ajoutée, export lancé, lien copié
- Position : coin bas-droit, durée 3s, dismiss au clic
- Style : fond `--bg-raised`, bordure `--border-default`, icône colorée selon type

**Inline éditeur — erreurs SQL**
- Ligne incriminée : gutter rouge + underline rouge sur le token fautif
- Message : bande sous l'éditeur (fond `--danger` 10% opacité), texte erreur + suggestion si détectable
- Pas de toast pour les erreurs SQL — feedback dans le contexte

**Streaming — feedback de progression**
- Résultats : compteur animé "Réception... 127 lignes" dans la barre résultats, `aria-live="polite"`
- Copilote : curseur clignotant `▋` après le dernier token, bouton envoi désactivé pendant le stream
- Schéma : skeleton progressif par groupe (Tables → Vues → Fonctions) plutôt qu'un spinner global

**Modale de confirmation — actions destructives uniquement**
- Ne jamais utiliser pour les succès ou les infos — réservé aux guardrails (voir `GuardrailModal`)

### Navigation & Raccourcis Clavier

Règle fondamentale : chaque action critique est atteignable au clavier sans la souris.

| Raccourci | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Ouvrir Command Menu global |
| `⌘Enter` / `Ctrl+Enter` | Exécuter la requête SQL |
| `⌘T` / `Ctrl+T` | Nouvel onglet éditeur |
| `⌘S` / `Ctrl+S` | Sauvegarder la requête courante |
| `⌘W` / `Ctrl+W` | Fermer l'onglet courant |
| `/` | Focus sur la recherche sidebar |
| `Escape` | Fermer overlay / modale / annuler streaming |
| `Ctrl+Espace` | Déclencher l'autocomplétion dans l'éditeur |
| `Ctrl+/` | Commenter/décommenter la sélection |

Les raccourcis sont affichés dans les tooltips et dans le Command Menu. Jamais cachés.

### États Vides & Loading

**État vide sidebar — aucune connexion**
Composant shadcn `Empty` (illustration neutre + titre + description + CTA) :
- Titre : "Aucune connexion"
- Description : "Connectez une base PostgreSQL ou MySQL pour commencer"
- CTA : bouton primaire "Ajouter une connexion" → ouvre le formulaire de connexion

**État vide résultats — requête valide sans résultats**
- Message inline dans la zone résultats : "Aucun résultat — 0 lignes en Xms"
- Pas d'illustration — le contexte SQL suffit

**État vide bibliothèque — aucune requête sauvegardée**
Composant shadcn `Empty` :
- Titre : "Aucune requête sauvegardée"
- Description : "Sauvegardez vos requêtes fréquentes pour les retrouver en 3 clics"
- CTA : lien "Comment sauvegarder ?" → tooltip

**Loading schéma**
Skeleton progressif par groupe (shadcn `Skeleton`) — pas de spinner global bloquant. Chaque groupe (Tables, Vues, Fonctions) apparaît dès que ses données sont reçues.

### Formulaires & Validation

**Connexion (champ principal)**
- Validation en temps réel sur blur (pas au keystroke)
- Bouton "Tester la connexion" → feedback inline immédiat (succès ✓ vert / erreur message rouge)
- Placeholder instructif : `postgresql://user:pass@host:5432/dbname`
- Erreur : texte rouge sous le champ, jamais de toast pour une erreur de formulaire

**Sauvegarde requête**
- Dialog non-bloquant (shadcn `Dialog`) avec nom pré-rempli depuis le contexte
- Toggle Privée / Partagée — visible et clair
- Validation : nom requis, longueur max 80 caractères — inline, pas de toast

**Règle générale :** les erreurs de saisie restent dans le formulaire. Les toasts sont réservés aux confirmations d'actions réussies.

### Confirmation Progressive

Niveaux croissants selon le risque — jamais sur-confirmer une action bénigne :

| Niveau | Déclencheur | UI |
|---|---|---|
| **0 — Aucune** | Sauvegarder, exporter, copier | Action directe + toast succès |
| **1 — Toast dismiss** | Supprimer une requête sauvegardée | Toast avec "Annuler" 5s |
| **2 — Dialog simple** | Déconnecter une connexion personnelle | `AlertDialog` Annuler / Confirmer |
| **3 — GuardrailModal** | DELETE/TRUNCATE/DROP SQL | Modale avec estimation lignes |
| **4 — Double confirmation** | Requête destructive sur connexion prod | GuardrailModal + saisie "CONFIRMER" |

### Patterns de Context Menu (clic droit)

**Sur un nœud table sidebar :**
1. ✦ Demander au copilote *(accent vert)*
2. — séparateur —
3. SELECT * FROM table LIMIT 100 `⌘↵`
4. Voir la structure
5. Copier le nom `⌘C`
6. — séparateur —
7. Statistiques (N rows)
8. Ajouter aux favoris ★
9. — séparateur —
10. Vider la table (TRUNCATE) *(danger rouge)*

**Sur une cellule résultat :**
1. Copier la valeur
2. Filtrer sur cette valeur → insère un WHERE dans l'éditeur
3. — séparateur —
4. Copier la ligne (JSON)

---

## Responsive Design & Accessibilité

### Stratégie Responsive

dblumi est un outil **desktop-first par conception** — un éditeur SQL, un arbre de schéma et un panel copilote simultanés ne peuvent pas être portés sur mobile sans trahir l'expérience. Ce choix est assumé et documenté.

| Cible | Viewport | Stratégie |
|---|---|---|
| **Desktop** | ≥ 1280px | Layout 3 colonnes natif — cible principale, tout est optimisé pour cette résolution |
| **Desktop compact** | 1024–1279px | Layout 3 colonnes, sidebar réduite à 220px, copilote à 280px |
| **Tablette** | 768–1023px | Sidebar repliable (icônes seules), copilote en Sheet drawer fermé par défaut, éditeur plein espace |
| **Mobile** | < 768px | Hors scope MVP — banner explicite "dblumi est conçu pour desktop" avec lien vers la documentation |

**Principe :** mieux vaut assumer clairement les limites que proposer une expérience mobile dégradée qui nuit à la réputation du produit.

### Breakpoints

```css
/* Tailwind v4 custom breakpoints */
--breakpoint-sm: 768px;   /* tablette — sidebar collapse */
--breakpoint-md: 1024px;  /* desktop compact */
--breakpoint-lg: 1280px;  /* desktop cible */
--breakpoint-xl: 1536px;  /* desktop large — copilote élargi 380px */
```

**Comportements par breakpoint :**
- `< 768px` : redirect/banner "desktop requis"
- `768–1023px` : `ResizablePanelGroup` sidebar collapse, copilote `Sheet` drawer
- `≥ 1024px` : layout complet 3 colonnes

### Stratégie d'Accessibilité — WCAG 2.1 AA

**Niveau cible : WCAG 2.1 AA** — standard industrie, suffisant pour un outil dev B2B open source. AAA non requis en MVP.

**Contrastes (vérifiés en step 8) :**
- Texte principal `#FAFAFA` / `#121314` → 16:1 ✅ (AAA)
- Texte secondaire `#A1A1AA` / `#121314` → 7.2:1 ✅ (AAA)
- Accent `#41cd2a` / `#121314` → 8.3:1 ✅ (AAA)
- Tous supérieurs au seuil AA (4.5:1) — aucun ajustement requis

**Navigation clavier :**
- Tous les éléments interactifs atteignables au clavier (Tab, Shift+Tab)
- Raccourcis globaux documentés (step 12) — pas de dépendance souris
- Focus trap dans les modales (Radix UI gère automatiquement via shadcn)
- `Escape` ferme systématiquement les overlays

**Focus rings :**
- `outline: 2px solid #41cd2a; outline-offset: 2px` — visible sur tous les backgrounds
- Jamais supprimé avec `outline: none` sans alternative visible

**ARIA & sémantique :**
- Radix UI (base shadcn) gère `aria-expanded`, `aria-selected`, `aria-controls`, `role` pour tous les composants primitifs
- `aria-live="polite"` sur la zone résultats streaming et les messages copilote
- `aria-label` explicite sur les boutons icône (`↑` send → "Envoyer au copilote", `×` → "Fermer le copilote")
- `aria-describedby` sur le GuardrailModal pointant vers l'estimation de lignes

**Tailles de cibles tactiles :**
- Minimum 44×44px pour les éléments interactifs en mode tablette
- Boutons icône 26×26px acceptables en desktop (souris précise), agrandis à 44px sur tablette via media query

**Daltonisme :**
- Aucune information portée uniquement par la couleur — toujours doublée par une icône ou un texte
- Ex : erreur SQL = couleur rouge + icône ⚠️ + texte descriptif (jamais la couleur seule)

### Stratégie de Test

**Tests automatisés (CI)**
- `axe-core` intégré dans les tests Playwright — violations WCAG bloquent la CI
- Snapshot tests Storybook pour les états des composants custom (SqlEditor, ResultsTable, CopilotPanel)
- Tests Playwright pour les flows clavier critiques : `⌘K` → navigation → sélection, `⌘Enter` → exécution, guardrail → annulation

**Tests manuels (développement)**
- Navigation clavier complète de chaque flow avant merge
- Test VoiceOver (macOS) sur les flows principaux
- Simulation daltonisme (Chrome DevTools) sur les états visuels critiques

**Tests navigateurs cibles :**
- Chrome N (prioritaire — audience dev)
- Firefox N-1
- Safari N (macOS — audience dev)
- Edge N (Windows)

### Guidelines d'Implémentation

**HTML sémantique :**
- `<nav>` pour la sidebar, `<main>` pour l'éditeur+résultats, `<aside>` pour le copilote
- `<button>` pour toutes les actions — jamais `<div onclick>`
- `<table>` avec `<thead>` / `<tbody>` et `scope="col"` pour les résultats

**Unités relatives :**
- `rem` pour les tailles de texte, `px` uniquement pour les bordures et les dimensions fixes de composants (ex : hauteur menubar 36px)
- Pas de tailles de police définies en `px` dans les composants réutilisables

**Responsive implementation :**
- CSS Grid + `ResizablePanelGroup` de shadcn pour le layout principal
- Sidebar collapse via `data-collapsed` attribute + transitions CSS
- Sheet drawer (shadcn) pour le copilote sur tablette — réutilise le composant existant
