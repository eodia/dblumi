import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const COLLAB_COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf',
]

export type CollabInstance = {
  doc: Y.Doc
  provider: WebsocketProvider
  ytext: Y.Text
  destroy: () => void
}

export function createCollabInstance(
  queryId: string,
  token: string,
  user: { userId: string; name: string; avatarUrl: string | null },
): CollabInstance {
  const doc = new Y.Doc()
  const ytext = doc.getText('sql')

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsBase = `${wsProtocol}//${window.location.host}/ws/collab`

  const provider = new WebsocketProvider(
    wsBase,
    queryId,
    doc,
    { params: { token } },
  )

  const awareness = provider.awareness

  // Pick a color not yet used by others
  const usedColors = new Set<string>()
  awareness.getStates().forEach((state) => {
    if (state.user?.color) usedColors.add(state.user.color as string)
  })
  const color = COLLAB_COLORS.find((c) => !usedColors.has(c)) ?? COLLAB_COLORS[0]!

  // Set local awareness state
  awareness.setLocalStateField('user', {
    userId: user.userId,
    name: user.name,
    avatarUrl: user.avatarUrl,
    color,
  })

  return {
    doc,
    provider,
    ytext,
    destroy: () => {
      provider.disconnect()
      provider.destroy()
      doc.destroy()
    },
  }
}
