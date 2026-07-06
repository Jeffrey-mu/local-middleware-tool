type GatewayConfig = {
  port: number
  strategy: 'priority' | 'round-robin' | 'weighted' | 'fastest'
  maxRetries: number
  circuitBreaker: {
    failureThreshold: number
    cooldownMs: number
  }
  providers: Array<{
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
  }>
  rules: Array<{
    id: string
    pattern: string
    providerIds: string[]
    enabled: boolean
  }>
}

type GatewayStatus = {
  config: GatewayConfig
}

const gatewayUrl = process.env.GATEWAY_TEST_URL ?? 'http://127.0.0.1:8787'
const providerBaseUrl = trimProviderBaseUrl(process.env.FENNO_BASE_URL ?? 'https://api.fenno.ai')
const apiKey = process.env.FENNO_API_KEY
let testModel = process.env.FENNO_TEST_MODEL

if (!apiKey) {
  throw new Error('Missing FENNO_API_KEY. Run with FENNO_API_KEY=... npm run test:fenno')
}

const fennoApiKey = apiKey
const originalStatus = await getJson<GatewayStatus>(`${gatewayUrl}/admin/status`)
const originalConfig = originalStatus.config

try {
  await putJson(`${gatewayUrl}/admin/config`, makeFennoConfig(originalConfig))
  await postJson(`${gatewayUrl}/admin/health-check`, {})

  testModel = await testModels()
  await testChatCompletion()
  await testStreamingChatCompletion()

  console.log('Fenno smoke tests passed.')
} finally {
  await putJson(`${gatewayUrl}/admin/config`, originalConfig).catch(() => undefined)
}

async function testModels() {
  const response = await fetch(`${gatewayUrl}/v1/models`, {
    headers: {
      authorization: 'Bearer gateway-test',
    },
  })

  assert(response.ok, `/v1/models failed with ${response.status}`)
  const payload = await response.json()
  assert(payload && typeof payload === 'object', '/v1/models returned a non-object payload')
  const discoveredModel = chooseModel(payload)
  console.log(`models: ${response.status}; selected ${discoveredModel}`)
  return discoveredModel
}

async function testChatCompletion() {
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer gateway-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: testModel,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: gateway-ok',
        },
      ],
      temperature: 0,
      max_tokens: 20,
    }),
  })

  const text = await response.text()
  assert(response.ok, `/v1/chat/completions failed with ${response.status}: ${text}`)

  const payload = JSON.parse(text)
  const content = payload?.choices?.[0]?.message?.content
  assert(typeof content === 'string' && content.length > 0, 'chat completion returned no message content')
  console.log(`chat: ${response.status}; model ${testModel}`)
}

async function testStreamingChatCompletion() {
  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer gateway-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: testModel,
      stream: true,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: stream-ok',
        },
      ],
      temperature: 0,
      max_tokens: 20,
    }),
  })

  assert(response.ok, `/v1/chat/completions stream failed with ${response.status}`)
  assert(response.body, 'stream response body is missing')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let chunks = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks += decoder.decode(value, { stream: true })
    if (chunks.includes('[DONE]')) break
  }

  assert(chunks.includes('data:'), 'stream did not contain SSE data frames')
  console.log(`stream: ${response.status}`)
}

function makeFennoConfig(config: GatewayConfig): GatewayConfig {
  const provider = {
    id: 'fenno',
    name: 'Fenno',
    baseUrl: providerBaseUrl,
    apiKey: fennoApiKey,
    apiKeys: [],
    priority: 1,
    weight: 100,
    timeoutMs: 30000,
    enabled: true,
    models: ['*'],
  }

  return {
    ...config,
    strategy: 'priority',
    providers: [provider, ...config.providers.filter((item) => item.id !== provider.id)],
    rules: [
      {
        id: 'fenno-smoke-test',
        pattern: '*',
        providerIds: [provider.id],
        enabled: true,
      },
      ...config.rules.filter((item) => item.id !== 'fenno-smoke-test'),
    ],
  }
}

function trimProviderBaseUrl(value: string) {
  const trimmed = value.replace(/\/$/, '')
  return trimmed
}

function chooseModel(payload: unknown) {
  if (testModel) return testModel
  const models = extractModelIds(payload)
  const preferred = ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.4', 'codex-auto-review']
  const selected = preferred.find((item) => models.includes(item)) ?? models.find((item) => !item.includes('image'))
  assert(selected, '/v1/models did not return any usable model ids')
  return selected
}

function extractModelIds(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) {
    return []
  }

  return payload.data
    .map((item) => {
      if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') return item.id
      if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string') return item.name
      return undefined
    })
    .filter((item): item is string => Boolean(item))
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const text = await response.text()
  assert(response.ok, `${url} failed with ${response.status}: ${text}`)
  return JSON.parse(text) as T
}

async function putJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  assert(response.ok, `${url} failed with ${response.status}: ${text}`)
}

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  assert(response.ok, `${url} failed with ${response.status}: ${text}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
