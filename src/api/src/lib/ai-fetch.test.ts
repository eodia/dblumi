import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: { AI_PROVIDER_SSL_VERIFY: true } }))

vi.mock('../config.js', () => ({ config: mocks.config }))

const { aiFetch } = await import('./ai-fetch.js')

describe('aiFetch', () => {
  it('keeps the SDK default fetch when AI_PROVIDER_SSL_VERIFY is true', () => {
    mocks.config.AI_PROVIDER_SSL_VERIFY = true
    expect(aiFetch()).toBeUndefined()
  })

  it('returns a shared insecure fetch when AI_PROVIDER_SSL_VERIFY is false', () => {
    mocks.config.AI_PROVIDER_SSL_VERIFY = false
    const f = aiFetch()
    expect(typeof f).toBe('function')
    expect(aiFetch()).toBe(f)
  })
})
