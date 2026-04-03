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

const MSG_SYNC = 0
const MSG_AWARENESS = 1

type CollabDoc = {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  connections: Map<WebSocket, number>
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
) {
  const collabDoc = await getOrCreateDoc(queryId)
  collabDoc.connections.set(ws, clientId)

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

  ws.on('message', (rawData: ArrayBuffer | Buffer) => {
    const data = new Uint8Array(rawData instanceof ArrayBuffer ? rawData : rawData.buffer)
    const decoder = decoding.createDecoder(data)
    const msgType = decoding.readVarUint(decoder)

    if (msgType === MSG_SYNC) {
      const responseEncoder = encoding.createEncoder()
      encoding.writeVarUint(responseEncoder, MSG_SYNC)
      syncProtocol.readSyncMessage(decoder, responseEncoder, collabDoc.doc, null)
      if (encoding.length(responseEncoder) > 1) {
        ws.send(encoding.toUint8Array(responseEncoder))
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(collabDoc.awareness, update, ws)
    }
  })

  ws.on('close', () => {
    collabDoc.connections.delete(ws)
    awarenessProtocol.removeAwarenessStates(collabDoc.awareness, [clientId], null)
    destroyDocIfEmpty(queryId)
  })
}
