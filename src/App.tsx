import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  Check,
  Clock,
  Clipboard,
  Database,
  DollarSign,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Settings,
  Square,
} from 'lucide-react'
import './App.css'

type Provider = {
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

type ProviderStatus = {
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

type GatewayConfig = {
  port: number
  strategy: 'priority' | 'round-robin' | 'weighted' | 'fastest'
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

type GatewayStatus = {
  endpoint: string
  config: GatewayConfig
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

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  state?: 'streaming' | 'error'
}

const emptyProvider = (): Provider => ({
  id: crypto.randomUUID(),
  name: '新的服务商',
  baseUrl: 'https://api.example.com/v1',
  apiKey: '',
  apiKeys: [],
  priority: 10,
  weight: 50,
  timeoutMs: 30000,
  enabled: false,
  models: ['*'],
})

function App() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [autosaving, setAutosaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [chatInput, setChatInput] = useState('你好，简单介绍一下当前网关是否可用。')
  const [chatModel, setChatModel] = useState('gpt-5.4')
  const [chatStream, setChatStream] = useState(true)
  const [chatRunning, setChatRunning] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      content: '这里会直接请求本地 /v1/responses，用来验证当前网关、模型和流式输出。',
    },
  ])
  const configDirtyRef = useRef(false)
  const chatAbortRef = useRef<AbortController | null>(null)

  async function refresh(options: { forceConfig?: boolean } = {}) {
    const response = await fetch('/admin/status')
    const data = (await response.json()) as GatewayStatus
    setStatus(data)
    setConfig((current) => {
      if (options.forceConfig || !current || !configDirtyRef.current) {
        return data.config
      }
      return current
    })
  }

  async function saveConfig() {
    if (!config) return
    setSaving(true)
    try {
      await persistConfig(config)
    } finally {
      setSaving(false)
    }
  }

  async function healthCheck() {
    if (!config) return
    setChecking(true)
    try {
      if (configDirtyRef.current) {
        await persistConfig(config)
      }
      await fetch('/admin/health-check', { method: 'POST' })
      await refresh({ forceConfig: true })
    } finally {
      setChecking(false)
    }
  }

  async function persistConfig(nextConfig: GatewayConfig) {
    const response = await fetch('/admin/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nextConfig),
    })
    if (!response.ok) {
      throw new Error(`Config save failed with ${response.status}`)
    }
    const data = await response.json()
    setConfig(data.config)
    configDirtyRef.current = false
    await refresh({ forceConfig: true })
  }

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!config || !configDirtyRef.current) return

    const timer = window.setTimeout(() => {
      setAutosaving(true)
      persistConfig(config)
        .catch((error) => console.warn('autosave failed', error))
        .finally(() => setAutosaving(false))
    }, 800)

    return () => window.clearTimeout(timer)
  }, [config])

  const statusByProvider = useMemo(() => {
    return new Map(status?.providers.map((provider) => [provider.providerId, provider]) ?? [])
  }, [status])

  if (!status || !config) {
    return <main className="boot">正在连接 AI 网关...</main>
  }

  const endpoint = status.endpoint
  const successRate = `${(status.metrics.successRate * 100).toFixed(2)}%`
  const analytics = status.analytics
  const modelOptions = [...new Set(config.providers.flatMap((provider) => provider.models).filter((model) => model && model !== '*'))]

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">本地 OpenAI 兼容网关</p>
          <h1>AI Gateway</h1>
        </div>
        <div className="status-pill">
          <span className="live-dot" />
          运行中
        </div>
      </section>

      <section className="endpoint-band">
        <div>
          <p className="label">本地接入地址</p>
          <strong>{endpoint}</strong>
        </div>
        <button
          className="icon-button"
          title="复制接入地址"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(endpoint)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check size={18} /> : <Clipboard size={18} />}
        </button>
      </section>

      <section className="metrics-grid">
        <Metric icon={<Activity />} label="今日请求" value={analytics.totalRequests.toLocaleString()} />
        <Metric icon={<Check />} label="成功率" value={successRate} />
        <Metric icon={<Database />} label="Token" value={formatToken(analytics.totalTokens)} />
        <Metric icon={<Clock />} label="平均响应" value={formatMs(analytics.avgLatencyMs)} />
        <Metric icon={<DollarSign />} label="费用估算" value={formatUsd(analytics.totalCost)} />
        <Metric icon={<Server />} label="在线" value={`${status.metrics.onlineProviders}/${config.providers.length}`} />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <div className="panel-title compact">
            <div>
              <p className="eyebrow">仪表盘</p>
              <h2>中转站统计</h2>
            </div>
            <BarChart3 size={18} />
          </div>
          <div className="provider-stats">
            {analytics.byProvider.map((item) => (
              <div className="stat-row" key={item.provider}>
                <div>
                  <strong>{item.provider}</strong>
                  <span>{item.requests} 次请求 · 成功率 {(item.successRate * 100).toFixed(1)}%</span>
                </div>
                <div className="stat-bar">
                  <i style={{ width: `${barWidth(item.requests, analytics.totalRequests)}%` }} />
                </div>
                <b>{formatMs(item.avgLatencyMs)}</b>
                <b>{formatToken(item.totalTokens)}</b>
              </div>
            ))}
            {!analytics.byProvider.length && <p className="empty">暂无中转站使用数据。</p>}
          </div>
        </div>

        <div className="panel chart-panel">
          <div className="panel-title compact">
            <div>
              <p className="eyebrow">模型</p>
              <h2>模型分布</h2>
            </div>
          </div>
          <div className="model-table">
            <div className="mini-head">
              <span>模型</span>
              <span>请求</span>
              <span>Token</span>
              <span>均值</span>
            </div>
            {analytics.byModel.map((item) => (
              <div className="mini-row" key={item.model}>
                <strong>{item.model}</strong>
                <span>{item.requests}</span>
                <span>{formatToken(item.totalTokens)}</span>
                <span>{formatMs(item.avgLatencyMs)}</span>
              </div>
            ))}
            {!analytics.byModel.length && <p className="empty">暂无模型使用数据。</p>}
          </div>
        </div>
      </section>

      <section className="panel chat-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">测试</p>
            <h2>对话窗口</h2>
          </div>
          <div className="chat-controls">
            <input
              aria-label="测试模型"
              list="gateway-models"
              value={chatModel}
              onChange={(event) => setChatModel(event.target.value)}
            />
            <datalist id="gateway-models">
              {modelOptions.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <button
              className={`segmented-toggle ${chatStream ? 'active' : ''}`}
              type="button"
              onClick={() => setChatStream((value) => !value)}
            >
              {chatStream ? '流式' : '非流式'}
            </button>
          </div>
        </div>

        <div className="chat-window">
          {chatMessages.map((message) => (
            <article className={`chat-message ${message.role} ${message.state ?? ''}`} key={message.id}>
              <span>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'AI' : '系统'}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <form className="chat-composer" onSubmit={sendTestMessage}>
          <textarea
            placeholder="输入一条测试消息"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {chatRunning ? (
            <button type="button" onClick={stopChat}>
              <Square size={16} />
              停止
            </button>
          ) : (
            <button type="submit" disabled={!chatInput.trim() || !chatModel.trim()}>
              <Send size={16} />
              发送
            </button>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">服务商</p>
            <h2>路由池</h2>
          </div>
          <div className="actions">
            <button type="button" onClick={healthCheck} disabled={checking}>
              <RefreshCw size={16} />
              {checking ? '检测中...' : '检测'}
            </button>
            <button
              type="button"
              onClick={() => updateConfig({ ...config, providers: [...config.providers, emptyProvider()] })}
            >
              <Plus size={16} />
              添加
            </button>
          </div>
        </div>

        <div className="provider-list">
          {config.providers.map((provider, index) => {
            const providerStatus = statusByProvider.get(provider.id)
            return (
              <article className="provider-row" key={provider.id}>
                <button
                  className={`toggle ${provider.enabled ? 'on' : ''}`}
                  title="启用服务商"
                  type="button"
                  onClick={() => updateProvider(index, { enabled: !provider.enabled })}
                />
                <div className="provider-main">
                  <input
                    value={provider.name}
                    onChange={(event) => updateProvider(index, { name: event.target.value })}
                  />
                  <input
                    value={provider.baseUrl}
                    onChange={(event) => updateProvider(index, { baseUrl: event.target.value })}
                  />
                </div>
                <div className="provider-secret">
                  <KeyRound size={16} />
                  <input
                    type="password"
                    placeholder="API Key"
                    value={provider.apiKey}
                    onChange={(event) => updateProvider(index, { apiKey: event.target.value })}
                  />
                </div>
                <NumberField
                  label="优先级"
                  value={provider.priority}
                  onChange={(value) => updateProvider(index, { priority: value })}
                />
                <NumberField
                  label="权重"
                  value={provider.weight}
                  onChange={(value) => updateProvider(index, { weight: value })}
                />
                <div className="health">
                  <span className={providerStatus?.online ? 'dot online' : 'dot'} />
                  <strong>{providerStatus?.latencyMs ? `${providerStatus.latencyMs}ms` : '离线'}</strong>
                  <small>{providerStatus?.requests ?? 0} 次请求</small>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="panel usage-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">使用记录</p>
            <h2>最近请求</h2>
          </div>
        </div>
        <div className="usage-table">
          <div className="usage-head">
            <span>API 密钥</span>
            <span>模型</span>
            <span>中转站</span>
            <span>端点</span>
            <span>类型</span>
            <span>Token</span>
            <span>费用</span>
            <span>耗时</span>
            <span>时间</span>
            <span>User-Agent</span>
          </div>
          {status.logs.slice(0, 80).map((log) => (
            <div className="usage-row" key={`${log.id}-${log.retry}-${log.provider}`}>
              <span>{log.apiKeyName}</span>
              <strong>{log.model}</strong>
              <span>{log.provider}</span>
              <span>{log.path.replace('/v1', '')}</span>
              <span><em>{log.stream ? '流式' : '非流式'}</em></span>
              <span className="numeric token-cell">
                <b>↓ {log.promptTokens.toLocaleString()}</b>
                <b>↑ {log.completionTokens.toLocaleString()}</b>
                <small>Σ {formatToken(log.totalTokens)}</small>
              </span>
              <span className="numeric cost">{formatUsd(log.costUsd)}</span>
              <span className="numeric">{formatMs(log.latencyMs)}</span>
              <time>{formatTime(log.at)}</time>
              <span className="user-agent">{log.userAgent || '未知'}</span>
            </div>
          ))}
          {!status.logs.length && <p className="empty">暂无请求记录。</p>}
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-title compact">
            <div>
              <p className="eyebrow">网关</p>
              <h2>设置</h2>
            </div>
            <Settings size={18} />
          </div>
          <label className="field">
            路由策略
            <select
              value={config.strategy}
              onChange={(event) => updateConfig({ ...config, strategy: event.target.value as GatewayConfig['strategy'] })}
            >
              <option value="priority">优先级</option>
              <option value="fastest">最快优先</option>
              <option value="round-robin">轮询</option>
              <option value="weighted">权重</option>
            </select>
          </label>
          <NumberField
            label="最大重试次数"
            value={config.maxRetries}
            onChange={(value) => updateConfig({ ...config, maxRetries: value })}
          />
          <NumberField
            label="熔断阈值"
            value={config.circuitBreaker.failureThreshold}
            onChange={(value) =>
              updateConfig({
                ...config,
                circuitBreaker: { ...config.circuitBreaker, failureThreshold: value },
              })
            }
          />
          <button className="primary" type="button" onClick={saveConfig}>
            <Save size={16} />
            {saving || autosaving ? '保存中...' : '保存配置'}
          </button>
        </div>

        <div className="panel">
          <div className="panel-title compact">
            <div>
              <p className="eyebrow">请求</p>
              <h2>简要日志</h2>
            </div>
          </div>
          <div className="logs">
            {status.logs.slice(0, 9).map((log) => (
              <div className="log-row" key={`${log.id}-${log.retry}-${log.provider}`}>
                <time>{new Date(log.at).toLocaleTimeString()}</time>
                <span>{log.model}</span>
                <strong>{log.provider}</strong>
                <b>{log.status}</b>
                <small>{log.latencyMs}ms</small>
              </div>
            ))}
            {!status.logs.length && <p className="empty">暂无请求日志。</p>}
          </div>
        </div>
      </section>
    </main>
  )

  function updateProvider(index: number, patch: Partial<Provider>) {
    configDirtyRef.current = true
    setConfig((current) => {
      if (!current) return current
      const nextProviders = current.providers.map((provider, providerIndex) =>
        providerIndex === index ? { ...provider, ...patch } : provider,
      )
      return { ...current, providers: nextProviders }
    })
  }

  function updateConfig(nextConfig: GatewayConfig) {
    configDirtyRef.current = true
    setConfig(nextConfig)
  }

  async function sendTestMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = chatInput.trim()
    const model = chatModel.trim()
    if (!prompt || !model || chatRunning) return

    const controller = new AbortController()
    const assistantId = crypto.randomUUID()
    chatAbortRef.current = controller
    setChatRunning(true)
    setChatInput('')
    setChatMessages((messages) => [
      ...messages,
      { id: crypto.randomUUID(), role: 'user', content: prompt },
      { id: assistantId, role: 'assistant', content: '', state: 'streaming' },
    ])

    try {
      const response = await fetch(`${endpoint}/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer gateway-dashboard-test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: prompt,
          stream: chatStream,
          store: false,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `HTTP ${response.status} ${response.statusText}`)
      }

      if (chatStream) {
        await readResponseStream(response, (delta) => appendAssistantText(assistantId, delta))
      } else {
        const payload = await response.json()
        appendAssistantText(assistantId, extractResponseText(payload) || JSON.stringify(payload, null, 2))
      }

      setChatMessages((messages) =>
        messages.map((message) => message.id === assistantId ? { ...message, state: undefined } : message),
      )
      await refresh()
    } catch (error) {
      if (controller.signal.aborted) {
        appendAssistantText(assistantId, '\n已停止。')
      } else {
        const message = error instanceof Error ? error.message : '未知错误'
        setChatMessages((messages) =>
          messages.map((item) =>
            item.id === assistantId
              ? { ...item, content: message, state: 'error' }
              : item,
          ),
        )
      }
    } finally {
      setChatRunning(false)
      chatAbortRef.current = null
    }
  }

  function stopChat() {
    chatAbortRef.current?.abort()
  }

  function appendAssistantText(id: string, text: string) {
    setChatMessages((messages) =>
      messages.map((message) =>
        message.id === id
          ? { ...message, content: `${message.content}${text}` }
          : message,
      ),
    )
  }
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      {label}
      <input
        min={0}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function formatToken(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

function formatMs(value: number) {
  if (!value) return '0ms'
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  return `${Math.round(value)}ms`
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function barWidth(value: number, total: number) {
  if (!total) return 0
  return Math.max(6, Math.round((value / total) * 100))
}

async function readResponseStream(response: Response, onDelta: (delta: string) => void) {
  if (!response.body) throw new Error('响应流为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n')

      if (!data || data === '[DONE]') continue

      try {
        const payload = JSON.parse(data)
        const delta = extractStreamDelta(payload)
        if (delta) onDelta(delta)
      } catch {
        // Ignore non-JSON event frames.
      }
    }
  }
}

function extractStreamDelta(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  if ('delta' in payload && typeof payload.delta === 'string') return payload.delta
  if ('type' in payload && payload.type === 'response.output_text.delta' && 'delta' in payload && typeof payload.delta === 'string') {
    return payload.delta
  }
  return ''
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('output' in payload) || !Array.isArray(payload.output)) return ''

  return payload.output
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) return []
      return item.content.map((content: unknown) => {
        if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text
        return ''
      })
    })
    .join('')
}

export default App
