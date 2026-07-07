import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { dataDir } from './paths.ts'

export const providerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional().default(''),
  apiKeys: z.array(z.string()).optional().default([]),
  priority: z.number().int().min(1).default(1),
  weight: z.number().int().min(1).default(100),
  timeoutMs: z.number().int().min(1000).default(30000),
  enabled: z.boolean().default(true),
  models: z.array(z.string()).optional().default([]),
})

export const ruleSchema = z.object({
  id: z.string(),
  pattern: z.string().min(1),
  providerIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

export const gatewayConfigSchema = z.object({
  port: z.number().int().default(8787),
  strategy: z.enum(['priority', 'round-robin', 'weighted', 'fastest']).default('priority'),
  maxRetries: z.number().int().min(0).max(10).default(3),
  circuitBreaker: z.object({
    failureThreshold: z.number().int().min(1).default(5),
    cooldownMs: z.number().int().min(1000).default(60000),
  }),
  providers: z.array(providerSchema).default([]),
  rules: z.array(ruleSchema).default([]),
})

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>
export type ProviderConfig = z.infer<typeof providerSchema>
export type RouteRule = z.infer<typeof ruleSchema>

const configPath = path.join(dataDir, 'gateway.json')

const defaultConfig: GatewayConfig = {
  port: 8787,
  strategy: 'priority',
  maxRetries: 3,
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  providers: [
    {
      id: 'polo',
      name: 'Polo API',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      apiKeys: [],
      priority: 1,
      weight: 100,
      timeoutMs: 30000,
      enabled: false,
      models: ['gpt-*'],
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      apiKeys: [],
      priority: 2,
      weight: 60,
      timeoutMs: 30000,
      enabled: false,
      models: ['*'],
    },
  ],
  rules: [
    {
      id: 'default-gpt',
      pattern: 'gpt-*',
      providerIds: ['polo', 'openrouter'],
      enabled: true,
    },
  ],
}

export async function loadConfig(): Promise<GatewayConfig> {
  await mkdir(dataDir, { recursive: true })

  try {
    const raw = await readFile(configPath, 'utf8')
    return gatewayConfigSchema.parse(JSON.parse(raw))
  } catch {
    await saveConfig(defaultConfig)
    return defaultConfig
  }
}

export async function saveConfig(config: GatewayConfig) {
  const parsed = gatewayConfigSchema.parse(config)
  await mkdir(dataDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(parsed, null, 2))
  return parsed
}
