export type Provider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  apiKeys: string[]
  priority: number
  weight: number
  timeoutMs: number
  enabled: boolean
  models: string[]
}

export type ProviderStatus = {
  providerId: string
  online: boolean
  latencyMs: number | null
  consecutiveFailures: number
  circuitOpenUntil: number | null
  requests: number
  successes: number
  failures: number
  status429: number
  status500: number
  timeouts: number
}

export type GatewayConfig = {
  port: number
  strategy: 'priority' | 'stable-priority' | 'round-robin' | 'weighted' | 'fastest'
  maxRetries: number
  circuitBreaker: {
    failureThreshold: number
    cooldownMs: number
  }
  providers: Provider[]
  rules: Array<{
    id: string
    pattern: string
    providerIds: string[]
    enabled: boolean
  }>
}

export type GatewayStatus = {
  endpoint: string
  config: GatewayConfig
  pricing: PricingTable
  metrics: {
    requests: number
    successes: number
    failures: number
    successRate: number
    onlineProviders: number
  }
  providers: ProviderStatus[]
  logs: Array<{
    id: string
    at: string
    apiKeyName: string
    model: string
    path: string
    method: string
    provider: string
    providerId: string
    status: number | string
    latencyMs: number
    retry: number
    stream: boolean
    billingMode: string
    promptTokens: number
    cachedTokens?: number
    completionTokens: number
    totalTokens: number
    costUsd: number
    firstTokenMs: number | null
    userAgent: string
    message?: string
  }>
  analytics: {
    totalRequests: number
    successRate: number
    totalTokens: number
    totalCost: number
    avgLatencyMs: number
    byProvider: Array<{
      provider: string
      requests: number
      successRate: number
      avgLatencyMs: number
      totalTokens: number
      costUsd: number
    }>
    byModel: Array<{
      model: string
      requests: number
      totalTokens: number
      avgLatencyMs: number
      costUsd: number
    }>
  }
}

export type ModelPricing = {
  model: string
  inputUsdPerMillion: number
  cachedInputUsdPerMillion: number
  outputUsdPerMillion: number
  source: string
  updatedAt: string
}

export type PricingTable = {
  models: ModelPricing[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  state?: 'streaming' | 'error'
}

export type ConfirmAction =
  | { kind: 'add-provider' }
  | { kind: 'delete-provider'; index: number; provider: Provider }

export type ViewId = 'overview' | 'providers' | 'rules' | 'pricing' | 'test' | 'logs' | 'settings'
export type ThemeMode = 'system' | 'dark' | 'light'
