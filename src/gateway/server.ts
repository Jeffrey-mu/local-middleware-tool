import Fastify from 'fastify'
import cors from '@fastify/cors'
import cron from 'node-cron'
import { nanoid } from 'nanoid'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { request } from 'undici'
import { loadConfig, saveConfig, type GatewayConfig } from './config.ts'
import { metricsSummary, probeProvider, providerAuthKey, selectProviders, trimProviderBaseUrl } from './router.ts'
import {
  addRequestLog,
  ensureProviderStatus,
  getProviderStatuses,
  getRequestLogs,
  loadRequestLogs,
  recordFailure,
  recordSuccess,
} from './state.ts'

let config: GatewayConfig = await loadConfig()
await loadRequestLogs()
const tracePath = path.join(process.cwd(), 'data', 'gateway-trace.jsonl')

for (const provider of config.providers) {
  ensureProviderStatus(provider)
}

const server = Fastify({
  logger: {
    level: 'info',
  },
  bodyLimit: 100 * 1024 * 1024,
})

await server.register(cors, { origin: true })

server.addHook('onRequest', async (request) => {
  if (!request.url.startsWith('/v1/')) return
  writeTraceEvent({
    phase: 'raw_request',
    method: request.method,
    path: request.url,
    userAgent: getHeader(request.headers, 'user-agent'),
    contentLength: getHeader(request.headers, 'content-length'),
    contentType: getHeader(request.headers, 'content-type'),
  })
})

server.setErrorHandler((error, request, reply) => {
  const normalizedError = normalizeFastifyError(error)
  writeTraceEvent({
    phase: 'fastify_error',
    method: request.method,
    path: request.url,
    userAgent: getHeader(request.headers, 'user-agent'),
    statusCode: normalizedError.statusCode,
    code: normalizedError.code,
    message: normalizedError.message,
  })
  reply.code(normalizedError.statusCode ?? 500).send({
    error: {
      message: normalizedError.message,
      type: 'gateway_request_error',
    },
  })
})

server.get('/admin/status', async () => ({
  endpoint: `http://127.0.0.1:${config.port}/v1`,
  config,
  metrics: metricsSummary(),
  providers: getProviderStatuses(),
  logs: getRequestLogs(),
  analytics: buildAnalytics(),
}))

server.get('/admin/trace', async () => ({
  traces: await readTraceEvents(),
}))

server.put('/admin/config', async (request) => {
  config = await saveConfig(request.body as GatewayConfig)
  for (const provider of config.providers) {
    ensureProviderStatus(provider)
  }
  return { ok: true, config }
})

server.post('/admin/health-check', async () => {
  await runHealthCheck()
  return {
    ok: true,
    providers: getProviderStatuses(),
  }
})

server.all('/v1/*', async (clientRequest, reply) => {
  const requestId = nanoid(10)
  const path = clientRequest.url.replace(/^\/v1/, '')
  const body = clientRequest.body == null ? undefined : JSON.stringify(clientRequest.body)
  const model = getModelName(clientRequest.body)
  const stream = isStreamingRequest(clientRequest.body)
  const userAgent = getHeader(clientRequest.headers, 'user-agent')
  const apiKeyName = formatApiKeyName(getHeader(clientRequest.headers, 'authorization'))
  const providers = selectProviders(config, model).slice(0, config.maxRetries + 1)

  writeTraceEvent({
    phase: 'incoming',
    requestId,
    method: clientRequest.method,
    path: clientRequest.url,
    model,
    stream,
    userAgent,
    bodyBytes: body ? Buffer.byteLength(body) : 0,
    providerCount: providers.length,
  })

  if (!providers.length) {
    reply.code(503)
    return {
      error: {
        message: 'No enabled provider is available.',
        type: 'gateway_unavailable',
      },
    }
  }

  let lastError = 'All providers failed.'

  for (const [retry, provider] of providers.entries()) {
    const started = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), provider.timeoutMs)
    const target = `${trimProviderBaseUrl(provider.baseUrl)}${path}`

    try {
      const headers = buildForwardHeaders(clientRequest.headers, provider)
      writeTraceEvent({
        phase: 'upstream_start',
        requestId,
        provider: provider.name,
        providerId: provider.id,
        target,
        retry,
      })
      const upstream = await request(target, {
        method: clientRequest.method,
        headers,
        body,
        signal: controller.signal,
      })
      const latencyMs = Date.now() - started
      const shouldFailover = upstream.statusCode === 429 || upstream.statusCode >= 500
      writeTraceEvent({
        phase: 'upstream_headers',
        requestId,
        provider: provider.name,
        providerId: provider.id,
        target,
        statusCode: upstream.statusCode,
        contentType: upstream.headers['content-type'],
        latencyMs,
        retry,
      })

      if (shouldFailover && retry < providers.length - 1) {
        const upstreamError = await readUpstreamError(upstream.body)
        recordFailure(provider, {
          latencyMs,
          statusCode: upstream.statusCode,
          failureThreshold: config.circuitBreaker.failureThreshold,
          cooldownMs: config.circuitBreaker.cooldownMs,
        })
        addRequestLog({
          id: requestId,
          at: new Date().toISOString(),
          apiKeyName,
          model,
          path: clientRequest.url,
          method: clientRequest.method,
          provider: provider.name,
          providerId: provider.id,
          status: upstream.statusCode,
          latencyMs,
          retry,
          stream,
          billingMode: '按量',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          firstTokenMs: null,
          userAgent,
          message: `Failover to next provider: ${formatUpstreamFailure(provider.name, target, upstream.statusCode, upstreamError)}`,
        })
        continue
      }

      if (upstream.statusCode >= 500) {
        const upstreamError = await readUpstreamError(upstream.body)
        const message = formatUpstreamFailure(provider.name, target, upstream.statusCode, upstreamError)
        recordFailure(provider, {
          latencyMs,
          statusCode: upstream.statusCode,
          failureThreshold: config.circuitBreaker.failureThreshold,
          cooldownMs: config.circuitBreaker.cooldownMs,
        })
        addRequestLog({
          id: requestId,
          at: new Date().toISOString(),
          apiKeyName,
          model,
          path: clientRequest.url,
          method: clientRequest.method,
          provider: provider.name,
          providerId: provider.id,
          status: upstream.statusCode,
          latencyMs,
          retry,
          stream,
          billingMode: '按量',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          firstTokenMs: null,
          userAgent,
          message,
        })

        reply.code(502)
        writeTraceEvent({
          phase: 'gateway_response',
          requestId,
          statusCode: 502,
          message,
        })
        return {
          error: {
            message,
            type: 'gateway_provider_error',
          },
        }
      }

      if (!stream && isJsonResponse(upstream.headers['content-type'])) {
        const responseText = await upstream.body.text()
        const usage = parseUsage(responseText)
        recordSuccess(provider, latencyMs)
        addRequestLog({
          id: requestId,
          at: new Date().toISOString(),
          apiKeyName,
          model,
          path: clientRequest.url,
          method: clientRequest.method,
          provider: provider.name,
          providerId: provider.id,
          status: upstream.statusCode,
          latencyMs,
          retry,
          stream,
          billingMode: '按量',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          costUsd: 0,
          firstTokenMs: null,
          userAgent,
        })

        reply.code(upstream.statusCode)
        for (const [key, value] of Object.entries(upstream.headers)) {
          if (value && key.toLowerCase() !== 'transfer-encoding') {
            reply.header(key, value)
          }
        }
        writeTraceEvent({
          phase: 'gateway_response',
          requestId,
          statusCode: upstream.statusCode,
          latencyMs,
        })
        return reply.send(responseText)
      }

      reply.code(upstream.statusCode)
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (value && key.toLowerCase() !== 'transfer-encoding') {
          reply.header(key, value)
        }
      }
      const firstTokenStarted = Date.now()
      const proxiedBody = proxyStreamingBody(upstream.body, {
        onComplete: (result) => {
          const completedLatencyMs = Date.now() - started
          recordSuccess(provider, completedLatencyMs)
          addRequestLog({
            id: requestId,
            at: new Date().toISOString(),
            apiKeyName,
            model,
            path: clientRequest.url,
            method: clientRequest.method,
            provider: provider.name,
            providerId: provider.id,
            status: upstream.statusCode,
            latencyMs: completedLatencyMs,
            retry,
            stream,
            billingMode: '按量',
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            costUsd: 0,
            firstTokenMs: result.firstTokenMs,
            userAgent,
          })
        },
        onError: (error) => {
          writeTraceEvent({
            phase: 'stream_proxy_error',
            requestId,
            provider: provider.name,
            providerId: provider.id,
            message: describeProviderError(error),
          })
        },
        startedAt: firstTokenStarted,
      })
      writeTraceEvent({
        phase: 'gateway_response',
        requestId,
        statusCode: upstream.statusCode,
        latencyMs,
        streamed: true,
      })
      return reply.send(proxiedBody)
    } catch (error) {
      const latencyMs = Date.now() - started
      const timeoutError = error instanceof Error && error.name === 'AbortError'
      const errorMessage = describeProviderError(error)
      lastError = `Provider ${provider.name} request failed at ${target}: ${errorMessage}`
      recordFailure(provider, {
        latencyMs,
        timeout: timeoutError,
        failureThreshold: config.circuitBreaker.failureThreshold,
        cooldownMs: config.circuitBreaker.cooldownMs,
      })
      addRequestLog({
        id: requestId,
        at: new Date().toISOString(),
        apiKeyName,
        model,
        path: clientRequest.url,
        method: clientRequest.method,
        provider: provider.name,
        providerId: provider.id,
        status: timeoutError ? 'timeout' : 'error',
        latencyMs,
        retry,
        stream,
        billingMode: '按量',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        firstTokenMs: null,
        userAgent,
        message: lastError,
      })
      writeTraceEvent({
        phase: 'upstream_error',
        requestId,
        provider: provider.name,
        providerId: provider.id,
        target,
        retry,
        latencyMs,
        message: lastError,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  reply.code(502)
  writeTraceEvent({
    phase: 'gateway_response',
    requestId,
    statusCode: 502,
    message: lastError,
  })
  return {
    error: {
      message: lastError,
      type: 'gateway_provider_error',
    },
  }
})

async function runHealthCheck() {
  await Promise.all(
    config.providers.map(async (provider) => {
      if (!provider.enabled) return
      const result = await probeProvider(provider)
      if (result.ok) {
        recordSuccess(provider, result.latencyMs, { countRequest: false })
      } else {
        recordFailure(provider, {
          latencyMs: result.latencyMs,
          statusCode: result.statusCode,
          failureThreshold: config.circuitBreaker.failureThreshold,
          cooldownMs: config.circuitBreaker.cooldownMs,
          countRequest: false,
        })
      }
    }),
  )
}

function isStreamingRequest(body: unknown) {
  return Boolean(body && typeof body === 'object' && 'stream' in body && body.stream === true)
}

function getHeader(headers: Record<string, unknown>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : ''
}

function formatApiKeyName(authorization: string) {
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return '未提供'
  if (token.startsWith('sk-')) return `${token.slice(0, 6)}...${token.slice(-4)}`
  return token.length > 18 ? `${token.slice(0, 12)}...` : token
}

function isJsonResponse(contentType: unknown) {
  if (Array.isArray(contentType)) return contentType.some((item) => item.includes('application/json'))
  return typeof contentType === 'string' && contentType.includes('application/json')
}

function parseUsage(responseText: string) {
  try {
    const payload = JSON.parse(responseText)
    const usage = payload?.usage ?? {}
    const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
    const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
    const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens)
    return { promptTokens, completionTokens, totalTokens }
  } catch {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }
}

async function readUpstreamError(body: { text(): Promise<string> }) {
  try {
    const text = await body.text()
    if (!text) return ''
    return summarizeUpstreamText(text)
  } catch (error) {
    return error instanceof Error ? `failed to read upstream error body: ${error.message}` : 'failed to read upstream error body'
  }
}

function summarizeUpstreamText(text: string) {
  try {
    const payload = JSON.parse(text)
    const message = payload?.error?.message ?? payload?.message ?? payload?.error
    if (typeof message === 'string') return message.slice(0, 500)
  } catch {
    // Fall through to a plain text summary.
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function formatUpstreamFailure(providerName: string, target: string, statusCode: number, detail: string) {
  const suffix = detail ? `: ${detail}` : ''
  return `Provider ${providerName} returned ${statusCode} from ${target}${suffix}`
}

function describeProviderError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown provider error'
  const cause = 'cause' in error && error.cause instanceof Error ? `; cause: ${error.cause.message}` : ''
  return `${error.name}: ${error.message || 'Unknown error'}${cause}`
}

function buildAnalytics() {
  const logs = getRequestLogs()
  const successes = logs.filter((log) => typeof log.status === 'number' && log.status >= 200 && log.status < 400)
  const totalTokens = logs.reduce((sum, log) => sum + log.totalTokens, 0)
  const totalCost = logs.reduce((sum, log) => sum + log.costUsd, 0)
  const avgLatency = successes.length
    ? successes.reduce((sum, log) => sum + log.latencyMs, 0) / successes.length
    : 0

  const byProvider = [...groupLogs(logs, (log) => log.provider).entries()].map(([provider, providerLogs]) => ({
    provider,
    requests: providerLogs.length,
    successRate: ratio(providerLogs.filter((log) => typeof log.status === 'number' && log.status < 400).length, providerLogs.length),
    avgLatencyMs: average(providerLogs.map((log) => log.latencyMs)),
    totalTokens: providerLogs.reduce((sum, log) => sum + log.totalTokens, 0),
    costUsd: providerLogs.reduce((sum, log) => sum + log.costUsd, 0),
  }))

  const byModel = [...groupLogs(logs, (log) => log.model).entries()].map(([model, modelLogs]) => ({
    model,
    requests: modelLogs.length,
    totalTokens: modelLogs.reduce((sum, log) => sum + log.totalTokens, 0),
    avgLatencyMs: average(modelLogs.map((log) => log.latencyMs)),
    costUsd: modelLogs.reduce((sum, log) => sum + log.costUsd, 0),
  }))

  return {
    totalRequests: logs.length,
    successRate: ratio(successes.length, logs.length),
    totalTokens,
    totalCost,
    avgLatencyMs: avgLatency,
    byProvider,
    byModel,
  }
}

async function readTraceEvents() {
  try {
    const raw = await readFile(tracePath, 'utf8')
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-200)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return { malformed: line }
        }
      })
  } catch {
    return []
  }
}

function writeTraceEvent(event: Record<string, unknown>) {
  const payload = {
    at: new Date().toISOString(),
    ...event,
  }
  mkdir(path.dirname(tracePath), { recursive: true })
    .then(() => appendFile(tracePath, `${JSON.stringify(payload)}\n`))
    .catch(() => undefined)
}

function normalizeFastifyError(error: unknown) {
  if (error instanceof Error) {
    const withMetadata = error as Error & { statusCode?: number; code?: string }
    return {
      message: error.message,
      statusCode: withMetadata.statusCode,
      code: withMetadata.code,
    }
  }
  return {
    message: 'Unknown request error',
    statusCode: 500,
    code: undefined,
  }
}

function groupLogs<T>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item) || '未知'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function ratio(value: number, total: number) {
  return total ? value / total : 1
}

function getModelName(body: unknown) {
  if (body && typeof body === 'object' && 'model' in body && typeof body.model === 'string') {
    return body.model
  }
  return '*'
}

function buildForwardHeaders(headers: Record<string, unknown>, provider: { apiKey?: string; apiKeys?: string[] }) {
  const forwarded: Record<string, string> = {
    'content-type': 'application/json',
  }

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (['host', 'content-length', 'connection'].includes(lower)) continue
    if (typeof value === 'string') forwarded[lower] = value
  }

  const apiKey = providerAuthKey(provider)
  if (apiKey) forwarded.authorization = `Bearer ${apiKey}`
  return forwarded
}

cron.schedule('*/30 * * * * *', () => {
  runHealthCheck().catch((error) => server.log.warn(error, 'health check failed'))
})

server.listen({ port: config.port, host: '127.0.0.1' }).catch((error) => {
  server.log.error(error)
  process.exit(1)
})
