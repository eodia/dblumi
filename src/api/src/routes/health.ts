import { Hono } from 'hono'

const health = new Hono()

health.get('/', (c) => {
  return c.json({ status: 'ok', version: '0.2.0', ts: new Date().toISOString() })
})

export { health }
