# Partage collaboratif — Design Spec

## Objectif

Ajouter un mode "collaboratif" au partage des requêtes sauvegardées. Contrairement au partage classique (lecture seule), le mode collaboratif permet aux destinataires de modifier et sauvegarder la requête. Cette spec couvre le modèle de données, l'API et l'UI du toggle collaboratif. L'édition temps réel (WebSocket, CodeMirror collab, présence, chat) fait l'objet de specs séparées.

## Modèle de données

### Modification des tables existantes

Ajout d'une colonne `collaborative` sur les deux tables de partage :

| Table | Colonne ajoutée | Type | Contraintes |
|-------|-----------------|------|-------------|
| `query_groups` | `collaborative` | INTEGER | NOT NULL DEFAULT 0 (boolean) |
| `query_users` | `collaborative` | INTEGER | NOT NULL DEFAULT 0 (boolean) |

- `collaborative = 0` → partage en lecture seule (comportement actuel)
- `collaborative = 1` → partage collaboratif (le destinataire peut modifier et sauvegarder la requête)

### Déduplication

Un même utilisateur ou groupe ne peut pas apparaître en lecture seule ET en collaboratif pour la même requête. Si un ID est ajouté en collaboratif alors qu'il est déjà en lecture seule, l'entrée lecture seule est supprimée et remplacée par l'entrée collaborative (et inversement).

### Champ `collaborative` sur la vue liste

Le `GET /saved-queries` retourne un nouveau champ `collaborative: boolean` sur chaque requête. Il est `true` si la requête a au moins un collaborateur (group ou user avec `collaborative = 1`). Ce champ sert à afficher l'icône `UserPlus` dans le panneau latéral.

De plus, pour les requêtes partagées avec l'utilisateur courant, un champ `isCollaborator: boolean` indique si l'utilisateur est collaborateur (peut éditer/sauvegarder) ou simple lecteur.

## API

### Modification de `PUT /saved-queries/:id/shares`

Le body accepte désormais 4 listes :

```json
{
  "groupIds": ["uuid", "..."],
  "userIds": ["uuid", "..."],
  "collabGroupIds": ["uuid", "..."],
  "collabUserIds": ["uuid", "..."]
}
```

- `groupIds` / `userIds` → insérés avec `collaborative = 0` (lecture seule)
- `collabGroupIds` / `collabUserIds` → insérés avec `collaborative = 1` (collaboratif)
- La déduplication est gérée côté backend : si un ID apparaît dans les deux listes (ex: dans `userIds` ET `collabUserIds`), seule l'entrée collaborative est créée.

### Modification de `GET /saved-queries/:id/shares`

La réponse inclut le flag `collaborative` sur chaque entrée :

```json
{
  "groups": [
    { "id": "uuid", "name": "Data Team", "color": "#3b82f6", "collaborative": false },
    { "id": "uuid", "name": "Dev Team", "color": "#22c55e", "collaborative": true }
  ],
  "users": [
    { "id": "uuid", "name": "Sophie", "email": "sophie@example.com", "collaborative": false },
    { "id": "uuid", "name": "Marc", "email": "marc@example.com", "collaborative": true }
  ]
}
```

### Modification de `PUT /saved-queries/:id` (permissions)

Actuellement, seul le propriétaire (`createdBy`) peut modifier une requête. Avec le mode collaboratif, le backend accepte aussi les modifications venant d'un collaborateur :

- Vérifier si `userId === createdBy` (propriétaire) → OK
- Sinon, vérifier si l'utilisateur est dans `query_users` avec `collaborative = 1`, ou dans un groupe de `query_groups` avec `collaborative = 1` → OK
- Sinon → 403 Forbidden

Cette vérification s'applique uniquement au `PUT` (modification). Le `DELETE` reste réservé au propriétaire.

## UI — Modale de partage

### Layout

La modale de partage existante est étendue avec un deuxième champ. Les deux champs sont empilés verticalement :

**Champ 1 — Partage en lecture seule** (existant, inchangé)
- Label : "Partage" (`sq.share`)
- Composant : `ComboboxChips` avec groupes et utilisateurs
- Rôle : les personnes et groupes ajoutés ici peuvent **voir** la requête dans leur panneau latéral et l'ouvrir en lecture seule. Ils ne peuvent pas la modifier ni la sauvegarder.

**Champ 2 — Partage collaboratif** (nouveau)
- Label : "Collaboratif" (`sq.collaborative`)
- Composant : `ComboboxChips` avec les mêmes options (groupes et utilisateurs)
- Rôle : les personnes et groupes ajoutés ici peuvent **voir, modifier et sauvegarder** la requête. C'est le mode d'édition partagée — chaque collaborateur peut ouvrir la requête, la modifier dans son éditeur et la sauvegarder pour tout le monde.

### Déduplication dans l'UI

Quand l'utilisateur ajoute quelqu'un dans le champ "Collaboratif" et qu'il est déjà dans "Partage", il est automatiquement retiré de "Partage". Et inversement : ajouter quelqu'un en "Partage" le retire de "Collaboratif". Un même destinataire ne peut être que dans un seul des deux champs.

## UI — Icône dans le panneau latéral

| Condition | Icône |
|-----------|-------|
| Requête partagée classique uniquement (pas de collaborateurs) | `Share2` (existant) |
| Requête avec au moins 1 collaborateur (`collaborative === true`) | `UserPlus` (lucide-react) |
| Requête non partagée | Pas d'icône |

L'icône `UserPlus` remplace `Share2` quand la requête a des collaborateurs, même si elle a aussi des partages en lecture seule.

Pour les requêtes partagées avec l'utilisateur courant : l'icône `UserPlus` est affichée si `isCollaborator === true`, sinon `Share2`.

## i18n

| Clé | EN | FR |
|-----|----|----|
| `sq.collaborative` | Collaborative | Collaboratif |
| `sq.collaborativeHint` | Can edit and save this query | Peut modifier et sauvegarder cette requête |

## Fichiers impactés

### Nouveaux fichiers
- `src/api/migrations/0008_collaborative_sharing.sql` — migration ALTER TABLE

### Fichiers modifiés
- `src/api/src/db/schema.ts` — ajout colonne `collaborative` sur `queryGroups` et `queryUsers`
- `src/api/src/routes/saved-queries.ts` — modification PUT shares + GET shares
- `src/api/src/services/saved-query.service.ts` — permission collaborateur dans `updateSavedQuery`, champ `collaborative` dans `listSavedQueries`
- `src/shared/src/types/query.ts` — ajout `collaborative` et `isCollaborator` sur `SavedQuery`
- `src/web/src/api/saved-queries.ts` — mise à jour types API shares
- `src/web/src/components/saved-queries/SavedQueriesPanel.tsx` — deuxième ComboboxChips + icône UserPlus
- `src/web/src/i18n/en.ts` — clés collaborative
- `src/web/src/i18n/fr.ts` — clés collaborative
