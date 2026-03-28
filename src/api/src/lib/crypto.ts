import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(config.DBLUMI_ENCRYPTION_KEY, 'hex') // 32 bytes

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Returns a Buffer containing: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 */
export function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted])
}

/**
 * Decrypts a Buffer produced by `encrypt`.
 */
export function decrypt(data: Buffer): string {
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)

  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(authTag)

  return (
    decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8')
  )
}
