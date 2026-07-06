import type { ProviderConfig } from './config.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ProviderStatus = {
  providerId: string
  online: boolean
  latencyMs: number | null
  consecutiveFailures: number
  circuitOpenUntil: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  requests: number
  successes: number
  failures: number
  status429: number
  status500: number
  timeouts: number
}

export type RequestLog = {
  id: string
  at: string
  apiKeyName: string
  model: string
  path: string
  method: string
  provider: string
  providerId: string
  status: number | 'timeout' | 'error'
  latencyMs: number
  retry: number
  stream: boolean
  billingMode: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  firstTokenMs: number | null
  userAgent: string
  message?: string
}

const statuses = new Map<string, ProviderStatus>()
const requestLogs: RequestLog[] = []
const usagePath = path.join(process.cwd(), 'data', 'usage.json')

export async function loadRequestLogs() {
  try {
    const raw = await readFile(usagePath, 'utf8')
    const savedLogs = JSON.parse(raw) as RequestLog[]
    requestLogs.splice(0, requestLogs.length, ...savedLogs.slice(0, 5000))
  } catch {
    requestLogs.splice(0, requestLogs.length)
  }
}

export function ensureProviderStatus(provider: ProviderConfig) {
  if (!statuses.has(provider.id)) {
    statuses.set(provider.id, {
      providerId: provider.id,
      online: false,
      latencyMs: null,
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      requests: 0,
      successes: 0,
      failures: 0,
      status429: 0,
      status500: 0,
      timeouts: 0,
    })
  }

  return statuses.get(provider.id)!
}

export function getProviderStatuses() {
  return [...statuses.values()]
}

export function recordSuccess(provider: ProviderConfig, latencyMs: number, options: { countRequest?: boolean } = {}) {
  const status = ensureProviderStatus(provider)
  status.online = true
  status.latencyMs = latencyMs
  status.consecutiveFailures = 0
  status.circuitOpenUntil = null
  status.lastSuccessAt = new Date().toISOString()
  if (options.countRequest !== false) {
    status.requests += 1
    status.successes += 1
  }
}

export function recordFailure(provider: ProviderConfig, options: {
  latencyMs: number
  statusCode?: number
  timeout?: boolean
  failureThreshold: number
  cooldownMs: number
  countRequest?: boolean
}) {
  const status = ensureProviderStatus(provider)
  status.online = false
  status.latencyMs = options.latencyMs
  status.lastFailureAt = new Date().toISOString()
  if (options.countRequest !== false) {
    status.requests += 1
    status.failures += 1
  }
  status.consecutiveFailures += 1

  if (options.statusCode === 429) status.status429 += 1
  if (options.statusCode && options.statusCode >= 500) status.status500 += 1
  if (options.timeout) status.timeouts += 1

  if (status.consecutiveFailures >= options.failureThreshold) {
    status.circuitOpenUntil = Date.now() + options.cooldownMs
  }
}

export function isCircuitOpen(provider: ProviderConfig) {
  const status = ensureProviderStatus(provider)
  return Boolean(status.circuitOpenUntil && status.circuitOpenUntil > Date.now())
}

export function addRequestLog(log: RequestLog) {
  requestLogs.unshift(log)
  requestLogs.length = Math.min(requestLogs.length, 5000)
  persistRequestLogs()
}

export function getRequestLogs() {
  return requestLogs
}

function persistRequestLogs() {
  mkdir(path.dirname(usagePath), { recursive: true })
    .then(() => writeFile(usagePath, JSON.stringify(requestLogs, null, 2)))
    .catch(() => undefined)
}
