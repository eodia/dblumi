import { Agent, fetch as undiciFetch } from 'undici'
import { config } from '../config.js'

let insecureFetch: typeof fetch | undefined

/**
 * `fetch` override for the AI SDK clients. Returns undefined (SDK default fetch) unless
 * AI_PROVIDER_SSL_VERIFY=false, in which case TLS certificate checks are skipped — scoped
 * to AI provider calls only, unlike NODE_TLS_REJECT_UNAUTHORIZED.
 */
export function aiFetch(): typeof fetch | undefined {
  if (config.AI_PROVIDER_SSL_VERIFY) return undefined
  if (!insecureFetch) {
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    insecureFetch = ((input, init) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      })) as typeof fetch
  }
  return insecureFetch
}
