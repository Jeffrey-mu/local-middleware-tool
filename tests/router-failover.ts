import assert from 'node:assert/strict'
import type { GatewayConfig, ProviderConfig } from '../src/gateway/config.ts'
import { selectProviders } from '../src/gateway/router.ts'

const provider = (patch: Partial<ProviderConfig>): ProviderConfig => ({
  id: patch.id ?? 'provider',
  name: patch.name ?? patch.id ?? 'provider',
  baseUrl: patch.baseUrl ?? 'https://api.example.com/v1',
  apiKey: '',
  apiKeys: [],
  priority: patch.priority ?? 1,
  weight: patch.weight ?? 100,
  timeoutMs: patch.timeoutMs ?? 30000,
  enabled: patch.enabled ?? true,
  models: patch.models ?? ['*'],
})

const config: GatewayConfig = {
  port: 8787,
  strategy: 'priority',
  maxRetries: 3,
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  providers: [
    provider({ id: 'limited', name: '限额中转站', priority: 1 }),
    provider({ id: 'new', name: '新中转站', priority: 2 }),
  ],
  rules: [
    {
      id: 'gpt-rule',
      pattern: 'gpt-*',
      providerIds: ['limited'],
      enabled: true,
    },
  ],
}

const selected = selectProviders(config, 'gpt-5.5').map((item) => item.id)

assert.deepEqual(selected, ['limited', 'new'])
console.log('router failover candidates ok')
