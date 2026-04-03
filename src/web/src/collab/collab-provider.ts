import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_CHAT = 2

const COLLAB_COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf',
]

export type CollabInstance = {
  doc: Y.Doc
  provider: WebsocketProvider
  ytext: Y.Text
  sendChatMessage: (content: string) => void
  onChatMessage: (handler: (msg: any) => void) => () => void
  destroy: () => void
}

let activeCollabInstance: CollabInstance | null = null
export function getActiveCollabInstance() { return activeCollabInstance }
export function setActiveCollabInstance(instance: CollabInstance | null) { activeCollabInstance = instance }

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

  // Chat message handling
  const chatHandlers = new Set<(msg: any) => void>()

  const setupWsListener = () => {
    const ws = (provider as any).ws as WebSocket | null
    if (!ws) return
    const prevOnMessage = ws.onmessage
    ws.onmessage = (event: MessageEvent) => {
      if (prevOnMessage) prevOnMessage.call(ws, event)
      try {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const decoder = decoding.createDecoder(data)
        const msgType = decoding.readVarUint(decoder)
        if (msgType === MSG_CHAT) {
          const jsonStr = decoding.readVarString(decoder)
          const msg = JSON.parse(jsonStr)
          chatHandlers.forEach((h) => h(msg))
        }
      } catch {
        // Not a chat message — ignore
      }
    }
  }

  provider.on('status', ({ status }: { status: string }) => {
    if (status === 'connected') {
      setTimeout(setupWsListener, 50)
    }
  })
  if (provider.wsconnected) {
    setTimeout(setupWsListener, 50)
  }

  const sendChatMessage = (content: string) => {
    const ws = (provider as any).ws as WebSocket | null
    if (!ws || ws.readyState !== 1) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_CHAT)
    encoding.writeVarString(encoder, content)
    ws.send(encoding.toUint8Array(encoder))
  }

  const onChatMessage = (handler: (msg: any) => void) => {
    chatHandlers.add(handler)
    return () => { chatHandlers.delete(handler) }
  }

  return {
    doc,
    provider,
    ytext,
    sendChatMessage,
    onChatMessage,
    destroy: () => {
      chatHandlers.clear()
      provider.disconnect()
      provider.destroy()
      doc.destroy()
    },
  }
}
