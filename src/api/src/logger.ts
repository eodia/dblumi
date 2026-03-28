import pino from 'pino'
import { config } from './config.js'

const isDev = process.env['NODE_ENV'] !== 'production'

export const logger = pino(
  { level: config.LOG_LEVEL },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined
)
