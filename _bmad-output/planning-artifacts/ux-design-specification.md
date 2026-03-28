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
| `--background` | `#0C0C0F` | Background principal |
| `--surface` | `#141418` | Panels, cartes |
| `--surface-2` | `#1A1A22` | Éditeur SQL, zones de code |
| `--border` | `#1E1E2E` | Bordures |
| `--foreground` | `#E8E8F2` | Texte principal |
| `--muted` | `#6B6B80` | Texte secondaire, placeholders |
| `--primary` | `#41cd2a` | Accent principal — vert électrique |
| `--primary-hover` | `#36b022` | States hover |
| `--primary-subtle` | `#41cd2a1a` | Backgrounds actifs, sélections |
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

- Texte principal : `#E8E8F2` / `#0C0C0F` → > 15:1 ✅ (AAA)
- Accent sur fond : `#41cd2a` / `#0C0C0F` → 8.5:1 ✅ (AAA)
- Focus rings : `#41cd2a` outline 2px — visible sur tous les backgrounds
- Taille minimum lisible : 13px (labels) — 14px pour tout le contenu principal
