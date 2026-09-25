import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

export class SqlitePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlitePathError'
  }
}

function realPath(p: string): string {
  const abs = path.resolve(p)
  try {
    return fs.realpathSync.native(abs)
  } catch {
    return abs // not created yet: nothing to follow
  }
}

const normalize = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)

/**
 * A SQLite connection opens a file on the dblumi server itself. Two limits:
 *  - never dblumi's own metadata database (or its WAL/SHM/journal files):
 *    anyone able to create a connection could otherwise rewrite `users.role`;
 *  - when `SQLITE_ALLOWED_DIR` is set, only files inside that directory.
 */
export function assertSqlitePathAllowed(filePath: string): void {
  if (filePath === ':memory:') return
  const target = normalize(realPath(filePath))

  const internal = realPath(config.DATABASE_PATH)
  const forbidden = [internal, `${internal}-wal`, `${internal}-shm`, `${internal}-journal`].map(normalize)
  if (forbidden.includes(target)) {
    throw new SqlitePathError("Ce fichier est la base interne de dblumi : il ne peut pas être ouvert comme connexion.")
  }

  if (config.SQLITE_ALLOWED_DIR) {
    const root = normalize(realPath(config.SQLITE_ALLOWED_DIR))
    if (!target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
      throw new SqlitePathError(`Les fichiers SQLite doivent se trouver dans ${config.SQLITE_ALLOWED_DIR}.`)
    }
  }
}

/**
 * libsql URL for a file path. libsql percent-decodes the path and cuts it at
 * `?` / `#`: those characters are encoded so that the file opened is exactly
 * the one `assertSqlitePathAllowed` checked (`dblumi%2edb` must not become `dblumi.db`).
 */
export function sqliteUrl(filePath: string): string {
  if (filePath === ':memory:') return ':memory:'
  return `file:${filePath.replace(/[%?#]/g, (c) => encodeURIComponent(c))}`
}
