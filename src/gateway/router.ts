import { request } from 'undici'
import type { GatewayConfig, ProviderConfig } from './config.ts'
import { ensureProviderStatus, getProviderStatuses, isCircuitOpen } from './state.ts'

let roundRobinIndex = 0

function matchesPattern(pattern: string, value: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

export function selectProviders(config: GatewayConfig, model: string) {
  const enabled = config.providers.filter((provider) => provider.enabled && !isCircuitOpen(provider))
  const matchingRule = config.rules.find((rule) => rule.enabled && matchesPattern(rule.pattern, model))

  let candidates = enabled
  if (matchingRule?.providerIds.length) {
    const preferred = matchingRule.providerIds
      .map((id) => enabled.find((provider) => provider.id === id))
      .filter(Boolean) as ProviderConfig[]
    const fallback = enabled.filter((provider) => !matchingRule.providerIds.includes(provider.id))
    candidates = preferred.length ? [...preferred, ...fallback] : enabled
  }

  if (config.strategy === 'fastest') {
    return candidates.toSorted((a, b) => {
      const aLatency = ensureProviderStatus(a).latencyMs ?? Number.MAX_SAFE_INTEGER
      const bLatency = ensureProviderStatus(b).latencyMs ?? Number.MAX_SAFE_INTEGER
      return aLatency - bLatency || a.priority - b.priority
    })
  }

  if (config.strategy === 'round-robin') {
    if (!candidates.length) return []
    const shifted = [...candidates.slice(roundRobinIndex), ...candidates.slice(0, roundRobinIndex)]
    roundRobinIndex = (roundRobinIndex + 1) % candidates.length
    return shifted
  }

  if (config.strategy === 'weighted') {
    return candidates.toSorted((a, b) => b.weight - a.weight || a.priority - b.priority)
  }

  return candidates.toSorted((a, b) => a.priority - b.priority)
}

export function providerAuthKey(provider: { apiKey?: string; apiKeys?: string[] }) {
  return provider.apiKeys?.find(Boolean) || provider.apiKey
}

export async function probeProvider(provider: ProviderConfig) {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(provider.timeoutMs, 10000))

  try {
    const baseUrl = trimProviderBaseUrl(provider.baseUrl)
    const headers = providerAuthKey(provider)
      ? { authorization: `Bearer ${providerAuthKey(provider)}` }
      : {}

    for (const path of ['/models', '/v1/models']) {
      const response = await request(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
      response.body.resume()
      const healthy = response.statusCode >= 200 && response.statusCode < 500 && isJsonContentType(response.headers['content-type'])
      if (healthy || path === '/v1/models') {
        return {
          ok: healthy,
          latencyMs: Date.now() - started,
          statusCode: response.statusCode,
        }
      }
    }

    return {
      ok: false,
      latencyMs: Date.now() - started,
      statusCode: 0,
    }
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      statusCode: 0,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function trimProviderBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/, '')
  return trimmed
}

function isJsonContentType(contentType: unknown) {
  if (Array.isArray(contentType)) return contentType.some((item) => item.includes('application/json'))
  return typeof contentType === 'string' && contentType.includes('application/json')
}

export function metricsSummary() {
  const statuses = getProviderStatuses()
  const requests = statuses.reduce((sum, item) => sum + item.requests, 0)
  const successes = statuses.reduce((sum, item) => sum + item.successes, 0)
  const failures = statuses.reduce((sum, item) => sum + item.failures, 0)
  const online = statuses.filter((item) => item.online).length

  return {
    requests,
    successes,
    failures,
    successRate: requests ? successes / requests : 1,
    onlineProviders: online,
  }
}
