import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket } from 'ws'
import { db } from '../db/index.js'
import { savedQueries } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { logger } from '../logger.js'
import { persistMessage } from '../services/collab-message.service.js'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
// MSG_CHAT removed — chat uses Y.Array synced via Yjs protocol

type CollabConnection = {
  clientId: number
  userId: string
  userName: string
  avatarUrl: string | null
}

type CollabDoc = {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connections: Map<WebSocket, CollabConnection>
}

const docs = new Map<string, CollabDoc>()

async function getOrCreateDoc(queryId: string): Promise<CollabDoc> {
  const existing = docs.get(queryId)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)

  const rows = await db
    .select({ sql: savedQueries.sql })
    .from(savedQueries)
    .where(eq(savedQueries.id, queryId))
    .limit(1)

  if (rows[0]) {
    const ytext = doc.getText('sql')
    ytext.insert(0, rows[0].sql)
  }

  const collabDoc: CollabDoc = { doc, awareness, connections: new Map() }
  docs.set(queryId, collabDoc)

  // Persist chat messages added to the Y.Array
  const ychat = doc.getArray('chat')
  ychat.observe((event) => {
    if (event.changes.added.size > 0) {
      event.changes.delta.forEach((d: any) => {
        if (d.insert) {
          for (const item of d.insert as any[]) {
            if (item.userId && item.content) {
              persistMessage(queryId, item.userId, item.content).catch((err) => {
                logger.error({ err, queryId }, 'Failed to persist chat message')
              })
            }
          }
        }
      })
    }
  })

  // Broadcast doc updates to all clients
  doc.on('update', (update: Uint8Array, origin: any) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const msg = encoding.toUint8Array(encoder)
    for (const [ws] of collabDoc.connections) {
      // Don't send back to the origin (the client that made the change)
      if (ws !== origin && ws.readyState === 1) {
        ws.send(msg)
      }
    }
  })

  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated, removed)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    )
    const msg = encoding.toUint8Array(encoder)
    broadcastToOthers(collabDoc, null, msg)
  })

  logger.info({ queryId }, 'Collab document created')
  return collabDoc
}

function broadcastToOthers(collabDoc: CollabDoc, sender: WebSocket | null, msg: Uint8Array) {
  for (const [ws] of collabDoc.connections) {
    if (ws !== sender && ws.readyState === 1) {
      ws.send(msg)
    }
  }
}

function destroyDocIfEmpty(queryId: string) {
  const collabDoc = docs.get(queryId)
  if (!collabDoc || collabDoc.connections.size > 0) return
  collabDoc.awareness.destroy()
  collabDoc.doc.destroy()
  docs.delete(queryId)
  logger.info({ queryId }, 'Collab document destroyed')
}

export async function handleCollabConnection(
  ws: WebSocket,
  queryId: string,
  clientId: number,
  userInfo: { userId: string; userName: string; avatarUrl: string | null },
) {
  const collabDoc = await getOrCreateDoc(queryId)
  collabDoc.connections.set(ws, { clientId, ...userInfo })

  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MSG_SYNC)
  syncProtocol.writeSyncStep1(encoder, collabDoc.doc)
  ws.send(encoding.toUint8Array(encoder))

  const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
    collabDoc.awareness,
    Array.from(collabDoc.awareness.getStates().keys()),
  )
  const awarenessEncoder = encoding.createEncoder()
  encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS)
  encoding.writeVarUint8Array(awarenessEncoder, awarenessStates)
  ws.send(encoding.toUint8Array(awarenessEncoder))

  ws.on('message', async (rawData: ArrayBuffer | Buffer) => {
    const data = rawData instanceof Uint8Array
      ? new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength)
      : new Uint8Array(rawData)
    const decoder = decoding.createDecoder(data)
    const msgType = decoding.readVarUint(decoder)

    if (msgType === MSG_SYNC) {
      const responseEncoder = encoding.createEncoder()
      encoding.writeVarUint(responseEncoder, MSG_SYNC)
      syncProtocol.readSyncMessage(decoder, responseEncoder, collabDoc.doc, ws)
      if (encoding.length(responseEncoder) > 1) {
        ws.send(encoding.toUint8Array(responseEncoder))
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(collabDoc.awareness, update, ws)
    }
  })

  ws.on('close', () => {
    const connInfo = collabDoc.connections.get(ws)
    collabDoc.connections.delete(ws)
    if (connInfo) {
      awarenessProtocol.removeAwarenessStates(collabDoc.awareness, [connInfo.clientId], null)
    }
    destroyDocIfEmpty(queryId)
  })
}
