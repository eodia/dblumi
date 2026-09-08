import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for getActiveProvider().
 *
 * The service module reads `config` from '../config.js', which validates
 * process.env at import time and calls process.exit(1) on failure. It also
 * pulls in the SQLite database and the pino logger. All three are mocked so
 * these tests stay pure: no env file, no database file, no log output.
 *
 * getActiveProvider() reads `config.*` at CALL time, so mutating the mocked
 * config object between tests is enough — no module reset is needed.
 */

type CopilotConfig = {
  DBLUMI_ENCRYPTION_KEY: string
  OLLAMA_BASE_URL?: string | undefined
  ANTHROPIC_API_KEY?: string | undefined
  MISTRAL_API_KEY?: string | undefined
  AZURE_OPENAI_API_KEY?: string | undefined
  AZURE_OPENAI_ENDPOINT?: string | undefined
  OPENAI_API_KEY?: string | undefined
}

const mocks = vi.hoisted(() => ({
  config: {
    // 32 bytes of hex — consumed at import time by lib/crypto.ts
    DBLUMI_ENCRYPTION_KEY: '0'.repeat(64),
  } as CopilotConfig,
  warn: vi.fn(),
}))

vi.mock('../config.js', () => ({ config: mocks.config }))
vi.mock('../logger.js', () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../db/index.js', () => ({ db: {} }))

const { getActiveProvider } = await import('./copilot.service.js')

/** Resets every AI env var, then applies the given ones. */
function setEnv(vars: Partial<CopilotConfig>): void {
  mocks.config.OLLAMA_BASE_URL = undefined
  mocks.config.ANTHROPIC_API_KEY = undefined
  mocks.config.MISTRAL_API_KEY = undefined
  mocks.config.AZURE_OPENAI_API_KEY = undefined
  mocks.config.AZURE_OPENAI_ENDPOINT = undefined
  mocks.config.OPENAI_API_KEY = undefined
  Object.assign(mocks.config, vars)
}

const OLLAMA = { OLLAMA_BASE_URL: 'http://localhost:11434' }
const ANTHROPIC = { ANTHROPIC_API_KEY: 'sk-ant-test' }
const MISTRAL = { MISTRAL_API_KEY: 'mistral-test' }
const AZURE = {
  AZURE_OPENAI_API_KEY: 'azure-test',
  AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
}
const OPENAI = { OPENAI_API_KEY: 'sk-openai-test' }

describe('getActiveProvider', () => {
  beforeEach(() => {
    mocks.warn.mockClear()
    setEnv({})
  })

  describe('no provider configured', () => {
    it("falls back to 'openai' and does not warn", () => {
      expect(getActiveProvider()).toBe('openai')
      expect(mocks.warn).not.toHaveBeenCalled()
    })
  })

  describe('a single provider configured', () => {
    it("returns 'ollama' for OLLAMA_BASE_URL alone", () => {
      setEnv(OLLAMA)
      expect(getActiveProvider()).toBe('ollama')
    })

    it("returns 'anthropic' for ANTHROPIC_API_KEY alone", () => {
      setEnv(ANTHROPIC)
      expect(getActiveProvider()).toBe('anthropic')
    })

    it("returns 'mistral' for MISTRAL_API_KEY alone", () => {
      setEnv(MISTRAL)
      expect(getActiveProvider()).toBe('mistral')
    })

    it("returns 'azure-openai' when both Azure key and endpoint are set", () => {
      setEnv(AZURE)
      expect(getActiveProvider()).toBe('azure-openai')
    })

    it("returns 'openai' for OPENAI_API_KEY alone", () => {
      setEnv(OPENAI)
      expect(getActiveProvider()).toBe('openai')
    })

    it('does not warn when exactly one provider is configured', () => {
      setEnv(MISTRAL)
      getActiveProvider()
      expect(mocks.warn).not.toHaveBeenCalled()
    })
  })

  describe('an incomplete Azure configuration is not counted', () => {
    it('ignores AZURE_OPENAI_API_KEY without an endpoint', () => {
      setEnv({ AZURE_OPENAI_API_KEY: 'azure-test' })
      expect(getActiveProvider()).toBe('openai')
      expect(mocks.warn).not.toHaveBeenCalled()
    })

    it('ignores AZURE_OPENAI_ENDPOINT without a key, leaving Mistral active', () => {
      setEnv({ ...MISTRAL, AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com' })
      expect(getActiveProvider()).toBe('mistral')
      expect(mocks.warn).not.toHaveBeenCalled()
    })
  })

  describe('priority: ollama > anthropic > mistral > azure-openai > openai', () => {
    it('prefers ollama over every other provider', () => {
      setEnv({ ...OLLAMA, ...ANTHROPIC, ...MISTRAL, ...AZURE, ...OPENAI })
      expect(getActiveProvider()).toBe('ollama')
    })

    it('prefers anthropic over mistral', () => {
      setEnv({ ...ANTHROPIC, ...MISTRAL })
      expect(getActiveProvider()).toBe('anthropic')
    })

    it('prefers anthropic over mistral, azure and openai', () => {
      setEnv({ ...ANTHROPIC, ...MISTRAL, ...AZURE, ...OPENAI })
      expect(getActiveProvider()).toBe('anthropic')
    })

    it('prefers mistral over azure-openai', () => {
      setEnv({ ...MISTRAL, ...AZURE })
      expect(getActiveProvider()).toBe('mistral')
    })

    it('prefers mistral over openai', () => {
      setEnv({ ...MISTRAL, ...OPENAI })
      expect(getActiveProvider()).toBe('mistral')
    })

    it('prefers mistral over both azure-openai and openai', () => {
      setEnv({ ...MISTRAL, ...AZURE, ...OPENAI })
      expect(getActiveProvider()).toBe('mistral')
    })

    it('prefers azure-openai over openai when mistral is absent', () => {
      setEnv({ ...AZURE, ...OPENAI })
      expect(getActiveProvider()).toBe('azure-openai')
    })
  })

  describe('warning when several providers are configured', () => {
    it('warns once and states the full priority order', () => {
      setEnv({ ...MISTRAL, ...OPENAI })
      getActiveProvider()
      expect(mocks.warn).toHaveBeenCalledTimes(1)
      expect(mocks.warn).toHaveBeenCalledWith(
        'Multiple AI providers configured. Priority: ollama > anthropic > mistral > azure-openai > openai.',
      )
    })

    it('warns when all five providers are configured', () => {
      setEnv({ ...OLLAMA, ...ANTHROPIC, ...MISTRAL, ...AZURE, ...OPENAI })
      getActiveProvider()
      expect(mocks.warn).toHaveBeenCalledTimes(1)
    })
  })
})
