# Édition collaborative temps réel — Design Spec

## Objectif

Permettre à plusieurs utilisateurs d'éditer simultanément une requête sauvegardée en mode collaboratif. Les modifications sont synchronisées en temps réel via WebSocket + Yjs (CRDT). Les curseurs distants sont visibles dans l'éditeur, et les avatars des participants apparaissent dans la toolbar.

Cette spec couvre : infrastructure WebSocket, intégration Yjs/CodeMirror, présence (avatars + curseurs). Le chat entre participants fait l'objet de la Spec 3.

## Architecture

### Stack technique

- **Yjs** — bibliothèque CRDT pour la synchronisation de documents
- **y-websocket** — provider WebSocket pour Yjs (client)
- **ws** — serveur WebSocket Node.js
- **y-codemirror.next** — binding CodeMirror 6 ↔ Yjs (contenu + curseurs)
- **@hono/node-ws** — support WebSocket pour Hono sur Node.js

### Vue d'ensemble

```
┌─────────────┐     WebSocket      ┌──────────────────────┐     WebSocket     ┌─────────────┐
│  Client A   │◄──────────────────►│   Serveur Hono       │◄────────────────►│  Client B   │
│  SqlEditor  │   /ws/collab/:id   │   (même process)     │  /ws/collab/:id  │  SqlEditor  │
│  + Yjs      │                    │   Y.Doc en mémoire   │                  │  + Yjs      │
│  + Awareness│                    │   Relay des updates   │                  │  + Awareness│
└─────────────┘                    └──────────────────────┘                  └─────────────┘
                                            │
                                            │ PUT /saved-queries/:id
                                            ▼
                                     ┌──────────────┐
                                     │   SQLite      │
                                     │   (source de  │
                                     │    vérité)    │
                                     └──────────────┘
```

## Serveur WebSocket

### Endpoint

`GET /ws/collab/:queryId` — upgrade HTTP → WebSocket

### Authentification

Le client passe son JWT en query parameter : `/ws/collab/:queryId?token=<jwt>`. Le serveur vérifie le token et que l'utilisateur est propriétaire ou collaborateur de la requête avant d'accepter l'upgrade. Si la vérification échoue → fermeture immédiate du WebSocket avec code 4001.

### Gestion des documents en mémoire

```typescript
Map<queryId, {
  doc: Y.Doc,
  connections: Set<WebSocket>,
  awareness: awarenessProtocol.Awareness
}>
```

- **Premier client se connecte** : créer le `Y.Doc`, charger le `savedQueries.sql` depuis la base, initialiser le `Y.Text('sql')` avec ce contenu
- **Clients suivants** : synchroniser l'état courant du `Y.Doc` via le protocole sync Yjs
- **Relay** : chaque update Yjs reçu d'un client est broadcasté à tous les autres clients du même `queryId`
- **Awareness** : les messages awareness (curseurs, présence) sont relayés de la même manière
- **Dernier client se déconnecte** : détruire le `Y.Doc` et libérer la mémoire

### Protocole de messages

Les messages WebSocket suivent le protocole Yjs standard :
- `messageSync` (type 0) — synchronisation de document (state vector, updates)
- `messageAwareness` (type 1) — présence et curseurs

Pas de protocole custom — on réutilise l'encodage Yjs natif.

## Client — Intégration CodeMirror

### Bascule standalone ↔ collaboratif

Le `QueryTab` dans `editor.store.ts` a déjà un champ `savedQueryId`. La requête retournée par l'API a `collaborative` (pour les requêtes propres) et `isCollaborator` (pour les requêtes partagées). Quand on ouvre une requête collaborative :

1. Le tab est marqué `collaborative: true` dans le store
2. `SqlEditor.tsx` détecte le flag et configure les extensions Yjs

### Extensions CodeMirror en mode collaboratif

En mode collaboratif, les extensions suivantes remplacent/complètent les extensions standard :

- `yCollab(ytext, awareness)` de `y-codemirror.next` — binding texte + curseurs distants
- `yUndoManagerKeymap` — remplace `historyKeymap` pour un undo/redo Yjs-aware
- L'extension `history()` standard est retirée (conflit avec Yjs)

En mode standalone, rien ne change — comportement actuel.

### Synchronisation store ↔ Yjs

Le `Y.Text` est la source de vérité en mode collaboratif. Un observer Yjs met à jour `tab.sql` dans le store Zustand à chaque changement, pour que la sauvegarde (Ctrl+S) lise le contenu Yjs courant.

### Cycle de vie de la connexion

1. **Ouverture du tab** (requête collaborative) → créer `Y.Doc`, `WebsocketProvider`, connecter au serveur
2. **Pendant l'édition** → les changements sont synchronisés automatiquement par Yjs
3. **Sauvegarde** (Ctrl+S) → `PUT /saved-queries/:id` avec `tab.sql` (contenu Yjs courant). Crée un snapshot de version automatiquement (feature Timeline).
4. **Fermeture du tab** → déconnecter le WebSocket, détruire le `Y.Doc` local
5. **Reconnexion** → `y-websocket` gère la reconnexion automatique. Au retour, le client se re-synchronise avec l'état serveur.

## Présence — Avatars dans la toolbar

### Emplacement

À côté du bouton "Sauvegarder" dans la toolbar de l'éditeur SQL. Visible uniquement quand le tab est en mode collaboratif.

### Affichage

- Rangée d'avatars circulaires empilés (style GitHub, léger overlap -8px)
- Chaque avatar a un bord (ring) de 2px de la couleur du curseur de l'utilisateur
- Si `avatarUrl` existe → image. Sinon → initiales sur fond coloré.
- Maximum 5 avatars visibles, puis badge `+N` pour les participants supplémentaires
- L'utilisateur courant n'apparaît pas dans la liste (il sait qu'il est là)

### Couleurs

Palette de 8 couleurs distinctes :
```
#f87171 (rouge), #fb923c (orange), #facc15 (jaune), #4ade80 (vert),
#38bdf8 (bleu), #a78bfa (violet), #f472b6 (rose), #2dd4bf (teal)
```

La couleur est attribuée au moment de la connexion : chaque client prend la première couleur disponible (non utilisée par un autre participant dans l'awareness). Cette couleur est partagée via l'awareness Yjs et utilisée pour :
- Le curseur distant dans l'éditeur
- Le label du curseur (nom de l'utilisateur)
- Le bord de l'avatar dans la toolbar

### Données awareness

Chaque client publie dans l'awareness Yjs :
```typescript
{
  userId: string,
  name: string,
  avatarUrl: string | null,
  color: string,   // couleur attribuée
}
```

## Dépendances

### Nouvelles (serveur — `src/api/package.json`)
- `ws` — serveur WebSocket Node.js
- `yjs` — bibliothèque CRDT
- `y-protocols` — protocoles sync/awareness Yjs
- `lib0` — utilitaires de base pour Yjs (encodage/décodage)

### Nouvelles (client — `src/web/package.json`)
- `yjs` — bibliothèque CRDT (même version)
- `y-websocket` — provider WebSocket client
- `y-codemirror.next` — binding CodeMirror ↔ Yjs
- `y-protocols` — protocoles sync/awareness

## i18n

| Clé | EN | FR |
|-----|----|----|
| `collab.connected` | Connected | Connecté |
| `collab.disconnected` | Disconnected | Déconnecté |
| `collab.reconnecting` | Reconnecting... | Reconnexion... |
| `collab.participants` | {count} participant(s) | {count} participant(s) |

## Fichiers impactés

### Nouveaux fichiers
- `src/api/src/collab/collab-server.ts` — gestion des documents Yjs en mémoire, relay WebSocket
- `src/api/src/collab/collab-auth.ts` — vérification JWT + permissions collaborateur pour le WebSocket
- `src/web/src/collab/collab-provider.ts` — factory pour créer le Y.Doc + WebsocketProvider + awareness
- `src/web/src/collab/collab-extensions.ts` — extensions CodeMirror pour le mode collaboratif
- `src/web/src/components/editor/CollabAvatars.tsx` — composant avatars de présence

### Fichiers modifiés
- `src/api/src/index.ts` — brancher le WebSocket upgrade sur le serveur HTTP
- `src/api/src/app.ts` — exporter l'app pour accès au serveur HTTP sous-jacent (si nécessaire)
- `src/web/src/stores/editor.store.ts` — flag `collaborative` sur `QueryTab`, gestion Y.Doc lifecycle
- `src/web/src/components/editor/SqlEditor.tsx` — bascule extensions standalone/collaboratif
- `src/shared/src/types/query.ts` — (déjà à jour avec `collaborative`/`isCollaborator`)
- `src/web/src/i18n/en.ts` — clés collab
- `src/web/src/i18n/fr.ts` — clés collab
