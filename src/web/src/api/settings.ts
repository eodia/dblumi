import { api } from './client'

export type CopilotInfo = {
  provider: 'anthropic' | 'openai' | 'azure-openai' | 'ollama'
  model: string
}

export const settingsApi = {
  getCopilotInfo: () => api.get<CopilotInfo>('/settings/copilot-info'),
  getAuthProviders: () => api.get<{ keycloak: boolean; github: boolean; google: boolean; smtpConfigured: boolean }>('/settings/auth-providers'),
}
