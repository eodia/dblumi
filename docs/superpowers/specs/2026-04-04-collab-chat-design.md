# Chat collaboratif — Design Spec

## Objectif

Ajouter un chat temps réel entre les participants d'une session d'édition collaborative sur une requête sauvegardée. Les messages sont persistés en base et rechargés quand un utilisateur revient. Le chat est accessible via un bouton dédié à côté des avatars, et s'affiche dans le panneau latéral droit (même zone que le Copilot).

## Modèle de données

### Nouvelle table `collab_messages`

| Colonne | Type | Contraintes |
|---------|------|-------------|
| id | UUID | PK |
| queryId | UUID | FK → savedQueries.id, ON DELETE CASCADE, NOT NULL |
| userId | UUID | FK → users.id, NOT NULL |
| content | TEXT | NOT NULL, max 2000 caractères |
| createdAt | TEXT | ISO timestamp, NOT NULL |

Index : `(queryId, createdAt ASC)` pour la pagination.

## API

### Nouvel endpoint

`GET /saved-queries/:id/messages?cursor=<createdAt>&limit=50`

- Pagination par curseur ASC (les plus anciens d'abord)
- `cursor` est la `createdAt` du dernier message chargé — retourne les messages plus récents que le curseur
- Pour le chargement initial (historique), on charge les N derniers messages (sans curseur, le endpoint retourne les 50 plus récents)
- Pour le scroll vers le haut (historique plus ancien), un paramètre `before=<createdAt>` charge les messages antérieurs

Format de réponse :

```json
{
  "messages": [
    {
      "id": "uuid",
      "userId": "uuid",
      "userName": "Marc",
      "avatarUrl": null,
      "content": "regarde la ligne 5",
      "createdAt": "2026-04-04T14:30:00Z"
    }
  ],
  "hasMore": true
}
```

### Pas d'endpoint POST

Les nouveaux messages sont envoyés via le WebSocket existant. Le serveur les persiste à la réception.

## Transport WebSocket

### Nouveau type de message

Ajout de `MSG_CHAT = 2` au protocole WebSocket du collab server (à côté de `MSG_SYNC = 0` et `MSG_AWARENESS = 1`).

### Envoi (client → serveur)

Le client encode un message `lib0` avec :
```
[MSG_CHAT, contentString]
```

### Réception (serveur)

À la réception d'un `MSG_CHAT`, le serveur :
1. Persiste le message en base (`collab_messages`) avec le `userId` du client (connu via la map de connexions)
2. Construit le message complet avec `id`, `userId`, `userName`, `avatarUrl`, `content`, `createdAt`
3. Broadcast le message encodé à **tous** les clients du `queryId` (y compris l'envoyeur, pour confirmation/affichage)

### Broadcast (serveur → clients)

Le message broadcasté est encodé `lib0` :
```
[MSG_CHAT, jsonString({ id, userId, userName, avatarUrl, content, createdAt })]
```

## Clic avatar → scroll au curseur

Quand l'utilisateur clique sur un avatar dans la barre de présence :
- Lire la position du curseur distant depuis l'awareness Yjs (le curseur est publié par `y-codemirror.next`)
- Appeler `EditorView.dispatch({ selection, scrollIntoView: true })` pour positionner la vue sur le curseur de l'utilisateur cliqué
- Le curseur distant est déjà coloré avec la couleur de l'utilisateur (via awareness)

## UI — Bouton chat

### Emplacement

À côté des avatars dans la barre collab au-dessus de l'éditeur (composant `CollabAvatars`). Icône `MessageSquare` de lucide-react.

### Badge

- Badge rouge avec compteur de messages non lus
- Le compteur s'incrémente à chaque message reçu via WebSocket quand le panneau chat est fermé
- Le compteur se reset quand l'utilisateur ouvre le panneau chat
- Stocké en mémoire dans le store Zustand (pas persisté entre sessions)

## UI — Panneau chat

### Emplacement

Même zone que le Copilot (panneau latéral droit). Quand on ouvre le chat, le Copilot se ferme. Quand on ouvre le Copilot, le chat se ferme. Un seul des deux visible à la fois.

### Layout (reprend le format CopilotPanel)

- **Header** : titre "Chat" + nom de la requête + bouton fermer (X)
- **Zone messages** : scrollable, les plus anciens en haut
  - Chargement de l'historique au scroll vers le haut (infinite scroll inversé via le GET paginé avec `before`)
  - Chaque message : avatar (cercle avec bord de la couleur du curseur), nom, heure relative, contenu
  - Messages de l'utilisateur courant alignés à droite, autres à gauche
- **Input** : zone de texte en bas, Entrée pour envoyer, Shift+Entrée pour saut de ligne

### Notifications sur l'onglet

- Point rouge sur l'onglet de la requête dans la barre d'onglets quand il y a des messages non lus
- Le point disparaît quand le panneau chat est ouvert ou quand l'utilisateur switch vers cet onglet et que le chat est visible

## i18n

| Clé | EN | FR |
|-----|----|----|
| `chat.title` | Chat | Chat |
| `chat.placeholder` | Type a message... | Écrire un message... |
| `chat.send` | Send | Envoyer |
| `chat.noMessages` | No messages yet | Aucun message |
| `chat.scrollToUser` | Go to cursor | Aller au curseur |

## Fichiers impactés

### Nouveaux fichiers
- `src/api/migrations/0009_collab_messages.sql` — migration CREATE TABLE
- `src/api/src/services/collab-message.service.ts` — CRUD messages (persist + list paginated)
- `src/api/src/routes/collab-messages.ts` — route GET messages (ou ajouté dans saved-queries.ts)
- `src/web/src/components/editor/CollabChat.tsx` — panneau chat complet
- `src/web/src/api/collab-messages.ts` — client API pour l'historique

### Fichiers modifiés
- `src/api/src/db/schema.ts` — ajout table `collabMessages`
- `src/api/migrations/meta/_journal.json` — entrée migration
- `src/api/src/collab/collab-server.ts` — handler `MSG_CHAT`, persist + broadcast, stocker userId par connexion
- `src/web/src/collab/collab-provider.ts` — exposer handler pour messages chat entrants
- `src/web/src/components/editor/CollabAvatars.tsx` — ajouter bouton chat + badge, clic avatar → scroll curseur
- `src/web/src/components/editor/SqlEditor.tsx` — rendre CollabChat, gérer ouverture/fermeture vs Copilot
- `src/web/src/stores/editor.store.ts` — compteur messages non lus par tab, état panneau chat
- `src/web/src/i18n/en.ts` — clés chat
- `src/web/src/i18n/fr.ts` — clés chat
