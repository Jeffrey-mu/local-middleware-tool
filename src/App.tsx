import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  Check,
  ChevronRight,
  Clock,
  Clipboard,
  Database,
  DollarSign,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  MessageSquareText,
  Monitor,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Route,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Zap,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { ScrollArea } from './components/ui/scroll-area'
import { Switch } from './components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group'
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

type GatewayStatus = {
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

type ModelPricing = {
  model: string
  inputUsdPerMillion: number
  cachedInputUsdPerMillion: number
  outputUsdPerMillion: number
  source: string
  updatedAt: string
}

type PricingTable = {
  models: ModelPricing[]
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  state?: 'streaming' | 'error'
}

type ConfirmAction =
  | { kind: 'add-provider' }
  | { kind: 'delete-provider'; index: number; provider: Provider }

type ViewId = 'overview' | 'providers' | 'rules' | 'pricing' | 'test' | 'logs' | 'settings'
type ThemeMode = 'system' | 'dark' | 'light'

const adminBaseUrl = import.meta.env.DEV ? '' : 'http://127.0.0.1:8787'

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
  const [activeView, setActiveView] = useState<ViewId>('providers')
  const [autosaving, setAutosaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [pricingSaving, setPricingSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('aigate-theme')
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system'
  })
  const [pricing, setPricing] = useState<PricingTable>({ models: [] })
  const [chatInput, setChatInput] = useState('你好，简单介绍一下当前网关是否可用。')
  const [chatModel, setChatModel] = useState('gpt-5.4')
  const [chatStream, setChatStream] = useState(true)
  const [chatRunning, setChatRunning] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      content: '这里会直接请求本地 /v1/responses，用来验证当前网关、模型和流式输出。',
    },
  ])
  const configDirtyRef = useRef(false)
  const chatAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme = themeMode === 'system' ? media.matches ? 'dark' : 'light' : themeMode
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme ?? 'dark'
    }
    localStorage.setItem('aigate-theme', themeMode)
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themeMode])

  async function refresh(options: { forceConfig?: boolean } = {}) {
    const response = await fetch(adminUrl('/admin/status'))
    const data = (await response.json()) as GatewayStatus
    setStatus(data)
    setPricing(data.pricing)
    setConfig((current) => {
      if (options.forceConfig || !current || !configDirtyRef.current) {
        return data.config
      }
      return current
    })
  }

  async function savePricing() {
    setPricingSaving(true)
    try {
      const response = await fetch(adminUrl('/admin/pricing'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          models: pricing.models.map((item) => ({
            ...item,
            source: item.source.trim() || 'manual',
            updatedAt: new Date().toISOString(),
          })),
        }),
      })
      if (!response.ok) throw new Error(`Pricing save failed with ${response.status}`)
      setPricing((await response.json()) as PricingTable)
      await refresh({ forceConfig: true })
    } finally {
      setPricingSaving(false)
    }
  }

  async function healthCheck() {
    if (!config) return
    setChecking(true)
    try {
      if (configDirtyRef.current) {
        await persistConfig(config)
      }
      await fetch(adminUrl('/admin/health-check'), { method: 'POST' })
      await refresh({ forceConfig: true })
    } finally {
      setChecking(false)
    }
  }

  async function persistConfig(nextConfig: GatewayConfig) {
    const response = await fetch(adminUrl('/admin/config'), {
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

  useEffect(() => {
    if (!config?.providers.length) {
      setSelectedProviderId(null)
      return
    }

    const selectedExists = selectedProviderId
      ? config.providers.some((provider) => provider.id === selectedProviderId)
      : false
    if (selectedExists) return

    const preferredProvider = config.providers.find((provider) => provider.enabled && statusByProvider.get(provider.id)?.online)
      ?? config.providers.find((provider) => provider.enabled)
      ?? config.providers[0]
    setSelectedProviderId(preferredProvider.id)
  }, [config?.providers, selectedProviderId, statusByProvider])

  if (!status || !config) {
    return (
      <main className="boot">
        <div className="boot-card">
          <span className="live-dot" />
          正在连接本地 AI 网关...
        </div>
      </main>
    )
  }

  const endpoint = status.endpoint
  const successRate = `${(status.metrics.successRate * 100).toFixed(2)}%`
  const analytics = status.analytics
  const modelOptions = [...new Set(config.providers.flatMap((provider) => provider.models).filter((model) => model && model !== '*'))]
  const enabledProviders = config.providers.filter((provider) => provider.enabled).length
  const latestLog = status.logs[0]
  const activeProvider = config.providers.find((provider) => provider.enabled && statusByProvider.get(provider.id)?.online)
    ?? config.providers.find((provider) => provider.enabled)
  const backupProviders = config.providers.filter((provider) => provider.enabled && provider.id !== activeProvider?.id).slice(0, 3)
  const navItems: Array<{ id: ViewId; label: string; icon: React.ReactNode; meta: string }> = [
    { id: 'overview', label: '控制', icon: <Gauge size={16} />, meta: `${formatToken(analytics.totalRequests)}` },
    { id: 'providers', label: '供应', icon: <Server size={16} />, meta: `${enabledProviders}/${config.providers.length}` },
    { id: 'rules', label: '路由', icon: <Route size={16} />, meta: config.strategy },
    { id: 'pricing', label: '价格', icon: <DollarSign size={16} />, meta: `${pricing.models.length}` },
    { id: 'test', label: '测试', icon: <MessageSquareText size={16} />, meta: chatStream ? 'SSE' : 'JSON' },
    { id: 'logs', label: '日志', icon: <TerminalSquare size={16} />, meta: `${status.logs.length}` },
  ]

  return (
    <main className="product-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <strong>AIGate</strong>
        </div>

        <div className="runtime-card">
          <div className="runtime-topline">
            <span className="live-dot" />
            <strong>运行中</strong>
          </div>
          <button
            className="endpoint-copy"
            title="复制接入地址"
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(endpoint)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            }}
          >
            <span>{endpoint.replace(/^https?:\/\//, '')}</span>
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
          </button>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
            >
              <span>{item.icon}</span>
              <strong>{item.label}</strong>
              <small>{item.meta}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="rail-settings" title="设置" type="button" onClick={() => setActiveView('settings')}>
            <Settings size={18} />
          </button>
          <span className="sync-label">{autosaving ? '保存中' : configDirtyRef.current ? '待保存' : '已同步'}</span>
        </div>
      </aside>

      <section className="workspace" id="main-content">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Local OpenAI Compatible Gateway</p>
            <h2>{viewTitle(activeView)}</h2>
          </div>
        </header>

        {activeView === 'overview' && (
          <section className="view-stack">
            <div className="control-hero">
              <div className="control-copy">
                <span className="status-pill"><span className="live-dot" /> Middleware Running</span>
                <h3>{enabledProviders ? '本地 AI 流量正在被接管' : '启用一个 Provider 后开始接管流量'}</h3>
                <p>{endpoint} · {strategyLabel(config.strategy)} · {status.metrics.onlineProviders} 个在线 Provider</p>
              </div>
              <Button type="button" onClick={() => setActiveView('test')}>
                测试请求
                <ChevronRight size={16} />
              </Button>
            </div>

            <section className="metrics-grid">
              <Metric icon={<Activity />} label="今日请求" value={analytics.totalRequests.toLocaleString()} />
              <Metric icon={<Check />} label="成功率" value={successRate} />
              <Metric icon={<Database />} label="Token" value={formatToken(analytics.totalTokens)} />
              <Metric icon={<Clock />} label="平均响应" value={formatMs(analytics.avgLatencyMs)} />
              <Metric icon={<DollarSign />} label="费用估算" value={formatUsd(analytics.totalCost)} />
              <Metric icon={<Server />} label="在线" value={`${status.metrics.onlineProviders}/${config.providers.length}`} />
            </section>

            <section className="command-grid">
              <RouteFlow
                activeProvider={activeProvider}
                backups={backupProviders}
                latestLog={latestLog}
                statusByProvider={statusByProvider}
                strategy={config.strategy}
              />
              <EventTimeline logs={status.logs} />
            </section>

            <section className="dashboard-grid">
              <div className="panel chart-panel">
                <PanelTitle eyebrow="仪表盘" title="中转站统计" icon={<BarChart3 size={18} />} />
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
                <PanelTitle eyebrow="模型" title="模型分布" />
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
          </section>
        )}

        {activeView === 'providers' && (
          <section className="panel provider-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">服务商</p>
                <h3>路由池</h3>
              </div>
              <div className="actions">
                <Button variant="secondary" type="button" onClick={healthCheck} disabled={checking}>
                  <RefreshCw size={16} />
                  {checking ? '检测中' : '检测'}
                </Button>
                <Button type="button" onClick={requestAddProvider}>
                  <Plus size={16} />
                  添加
                </Button>
              </div>
            </div>

            <div className="provider-card-grid">
              {config.providers.map((provider, index) => {
                const providerStatus = statusByProvider.get(provider.id)
                return (
                  <ProviderEditor
                    key={provider.id}
                    provider={provider}
                    providerStatus={providerStatus}
                    selected={selectedProviderId === provider.id}
                    onSelect={() => setSelectedProviderId(provider.id)}
                    onDelete={() => requestRemoveProvider(index)}
                    onChange={(patch) => updateProvider(index, patch)}
                  />
                )
              })}
            </div>
          </section>
        )}

        {activeView === 'rules' && (
          <section className="settings-grid">
            <div className="panel">
              <PanelTitle eyebrow="网关" title="路由设置" icon={<Settings size={18} />} />
              <label className="field">
                路由策略
                <select value={config.strategy} onChange={(event) => updateConfig({ ...config, strategy: event.target.value as GatewayConfig['strategy'] })}>
                  <option value="priority">优先级</option>
                  <option value="stable-priority">稳定优先</option>
                  <option value="fastest">最快优先</option>
                  <option value="round-robin">轮询</option>
                  <option value="weighted">权重</option>
                </select>
              </label>
              <NumberField label="最大重试次数" value={config.maxRetries} onChange={(value) => updateConfig({ ...config, maxRetries: value })} />
              <NumberField
                label="熔断阈值"
                value={config.circuitBreaker.failureThreshold}
                onChange={(value) => updateConfig({ ...config, circuitBreaker: { ...config.circuitBreaker, failureThreshold: value } })}
              />
              <NumberField
                label="熔断冷却毫秒"
                value={config.circuitBreaker.cooldownMs}
                onChange={(value) => updateConfig({ ...config, circuitBreaker: { ...config.circuitBreaker, cooldownMs: value } })}
              />
            </div>

            <div className="panel">
              <PanelTitle eyebrow="模型规则" title="规则列表" />
              <div className="rule-list">
                {config.rules.map((rule) => (
                  <article className="rule-row" key={rule.id}>
                    <span className={rule.enabled ? 'dot online' : 'dot'} />
                    <strong>{rule.pattern}</strong>
                    <small>{rule.providerIds.join(' -> ') || '未绑定服务商'}</small>
                  </article>
                ))}
                {!config.rules.length && <p className="empty">暂无模型路由规则，当前使用全局策略。</p>}
              </div>
            </div>
          </section>
        )}

        {activeView === 'test' && (
          <section className="panel chat-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">测试</p>
                <h3>对话窗口</h3>
              </div>
              <div className="chat-controls">
                <input aria-label="测试模型" list="gateway-models" value={chatModel} onChange={(event) => setChatModel(event.target.value)} />
                <datalist id="gateway-models">
                  {modelOptions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <Button variant={chatStream ? 'default' : 'secondary'} type="button" onClick={() => setChatStream((value) => !value)}>
                  {chatStream ? '流式' : '非流式'}
                </Button>
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
                <Button type="button" onClick={stopChat}>
                  <Square size={16} />
                  停止
                </Button>
              ) : (
                <Button type="submit" disabled={!chatInput.trim() || !chatModel.trim()}>
                  <Send size={16} />
                  发送
                </Button>
              )}
            </form>
          </section>
        )}

        {activeView === 'pricing' && (
          <section className="panel pricing-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">本地存储</p>
                <h3>模型定价</h3>
              </div>
              <div className="actions">
                <Button variant="secondary" type="button" onClick={addPricingRow}>
                  <Plus size={16} />
                  添加模型
                </Button>
                <Button type="button" onClick={savePricing} disabled={pricingSaving}>
                  <Save size={16} />
                  {pricingSaving ? '保存中' : '保存定价'}
                </Button>
              </div>
            </div>

            <div className="pricing-table">
              <div className="pricing-head">
                <span>模型</span>
                <span>输入 $/1M</span>
                <span>缓存输入 $/1M</span>
                <span>输出 $/1M</span>
                <span>来源</span>
                <span>更新时间</span>
              </div>
              {pricing.models.map((item, index) => (
                <div className="pricing-row" key={`${item.model}-${index}`}>
                  <input
                    aria-label="模型"
                    value={item.model}
                    onChange={(event) => updatePricingRow(index, { model: event.target.value })}
                  />
                  <input
                    aria-label="输入价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.inputUsdPerMillion}
                    onChange={(event) => updatePricingRow(index, { inputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="缓存输入价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.cachedInputUsdPerMillion}
                    onChange={(event) => updatePricingRow(index, { cachedInputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="输出价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.outputUsdPerMillion}
                    onChange={(event) => updatePricingRow(index, { outputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="来源"
                    value={item.source}
                    onChange={(event) => updatePricingRow(index, { source: event.target.value })}
                  />
                  <div className="pricing-meta">
                    <time>{item.updatedAt ? formatTime(item.updatedAt) : '未保存'}</time>
                    <Button className="text-action" variant="ghost" type="button" onClick={() => removePricingRow(index)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              {!pricing.models.length && <p className="empty">暂无模型定价。添加后，费用统计会按这里的价格重新用于新请求。</p>}
            </div>
          </section>
        )}

        {activeView === 'logs' && (
          <section className="panel usage-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">使用记录</p>
                <h3>最近请求</h3>
              </div>
            </div>
            <UsageTable logs={status.logs} />
          </section>
        )}

        {activeView === 'settings' && (
          <SettingsView
            themeMode={themeMode}
            onBack={() => setActiveView('providers')}
            onThemeModeChange={setThemeMode}
          />
        )}

        <ConfirmActionDialog
          action={confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmPendingAction}
        />
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

  function requestAddProvider() {
    if (!config) return
    setConfirmAction({ kind: 'add-provider' })
  }

  function requestRemoveProvider(index: number) {
    if (!config) return
    const provider = config.providers[index]
    if (!provider) return
    setConfirmAction({ kind: 'delete-provider', index, provider })
  }

  function confirmPendingAction() {
    if (!confirmAction) return
    if (confirmAction.kind === 'add-provider') {
      addProvider()
    } else {
      removeProvider(confirmAction.index, confirmAction.provider.id)
    }
    setConfirmAction(null)
  }

  function addProvider() {
    if (!config) return
    const provider = emptyProvider()
    setSelectedProviderId(provider.id)
    updateConfig({ ...config, providers: [...config.providers, provider] })
  }

  function removeProvider(index: number, providerId: string) {
    if (!config) return
    const provider = config.providers[index]
    if (!provider || provider.id !== providerId) return

    const nextProviders = config.providers.filter((_, providerIndex) => providerIndex !== index)
    const nextSelectedProvider = nextProviders[Math.min(index, nextProviders.length - 1)] ?? null
    setSelectedProviderId(nextSelectedProvider?.id ?? null)
    updateConfig({
      ...config,
      providers: nextProviders,
      rules: config.rules.map((rule) => ({
        ...rule,
        providerIds: rule.providerIds.filter((providerId) => providerId !== provider.id),
      })),
    })
  }

  function addPricingRow() {
    setPricing((current) => ({
      models: [
        ...current.models,
        {
          model: '',
          inputUsdPerMillion: 0,
          cachedInputUsdPerMillion: 0,
          outputUsdPerMillion: 0,
          source: 'manual',
          updatedAt: '',
        },
      ],
    }))
  }

  function updatePricingRow(index: number, patch: Partial<ModelPricing>) {
    setPricing((current) => ({
      models: current.models.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function removePricingRow(index: number) {
    setPricing((current) => ({
      models: current.models.filter((_, itemIndex) => itemIndex !== index),
    }))
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
          messages.map((item) => item.id === assistantId ? { ...item, content: message, state: 'error' } : item),
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
      messages.map((message) => message.id === id ? { ...message, content: `${message.content}${text}` } : message),
    )
  }
}

function PanelTitle({ eyebrow, title, icon }: { eyebrow: string; title: string; icon?: React.ReactNode }) {
  return (
    <div className="panel-title compact">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {icon}
    </div>
  )
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

function SettingsView({
  themeMode,
  onBack,
  onThemeModeChange,
}: {
  themeMode: ThemeMode
  onBack: () => void
  onThemeModeChange: (themeMode: ThemeMode) => void
}) {
  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <button className="settings-back" type="button" onClick={onBack} title="返回">
          <ChevronRight size={18} />
        </button>
        <h3>设置</h3>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button className="active" type="button">通用</button>
        <button type="button">路由</button>
        <button type="button">认证</button>
        <button type="button">高级</button>
        <button type="button">使用统计</button>
        <button type="button">关于</button>
      </div>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="settings-section-copy">
            <strong>外观主题</strong>
            <span>选择 AIGate 在桌面环境中的显示方式。</span>
          </div>
          <ToggleGroup
            className="theme-toggle"
            size="sm"
            spacing={1}
            type="single"
            value={themeMode}
            onValueChange={(value) => {
              if (value === 'system' || value === 'dark' || value === 'light') onThemeModeChange(value)
            }}
          >
            <ToggleGroupItem value="light">
              <Sun size={15} />
              浅色
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              <Moon size={15} />
              深色
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
              <Monitor size={15} />
              跟随系统
            </ToggleGroupItem>
          </ToggleGroup>
        </section>

        <section className="settings-section">
          <div className="settings-section-copy">
            <strong>滚动条</strong>
            <span>侧栏固定，日志和表格只在内容区内部滚动。</span>
          </div>
          <span className="setting-state">已优化</span>
        </section>
      </div>
    </section>
  )
}

function RouteFlow({
  activeProvider,
  backups,
  latestLog,
  statusByProvider,
  strategy,
}: {
  activeProvider?: Provider
  backups: Provider[]
  latestLog?: GatewayStatus['logs'][number]
  statusByProvider: Map<string, ProviderStatus>
  strategy: GatewayConfig['strategy']
}) {
  const activeStatus = activeProvider ? statusByProvider.get(activeProvider.id) : undefined
  return (
    <section className="panel route-flow-panel">
      <PanelTitle eyebrow="Route Flow" title="当前请求路径" icon={<Network size={18} />} />
      <div className="route-flow">
        <div className="route-node source">
          <Sparkles size={18} />
          <span>Codex / Cursor</span>
          <strong>OpenAI SDK</strong>
        </div>
        <div className="route-line"><i /></div>
        <div className="route-node router">
          <Zap size={18} />
          <span>{strategyLabel(strategy)}</span>
          <strong>AIGate Router</strong>
        </div>
        <div className="route-line"><i /></div>
        <div className="route-node provider">
          <Server size={18} />
          <span>{activeStatus?.online ? 'Primary online' : 'Waiting route'}</span>
          <strong>{activeProvider?.name ?? '未启用 Provider'}</strong>
          <small>{activeStatus?.latencyMs ? formatMs(activeStatus.latencyMs) : latestLog ? formatMs(latestLog.latencyMs) : 'no traffic'}</small>
        </div>
      </div>
      <div className="backup-strip">
        {backups.map((provider) => {
          const providerStatus = statusByProvider.get(provider.id)
          return (
            <span key={provider.id}>
              <span className={providerStatus?.online ? 'dot online' : 'dot'} />
              {provider.name}
            </span>
          )
        })}
        {!backups.length && <span>暂无备用 Provider</span>}
      </div>
    </section>
  )
}

function EventTimeline({ logs }: { logs: GatewayStatus['logs'] }) {
  return (
    <section className="panel event-panel">
      <PanelTitle eyebrow="Timeline" title="最近事件" icon={<Clock size={18} />} />
      <div className="event-timeline">
        {logs.slice(0, 6).map((log) => (
          <article className="event-item" key={`${log.id}-${log.retry}-${log.provider}`}>
            <time>{formatTime(log.at)}</time>
            <div>
              <strong>{log.retry > 0 ? 'Auto switch' : statusOk(log.status) ? 'Request success' : 'Route warning'}</strong>
              <span>{log.provider} · {log.model} · {formatMs(log.latencyMs)}</span>
            </div>
            <em className={statusOk(log.status) ? 'ok' : 'warn'}>{String(log.status)}</em>
          </article>
        ))}
        {!logs.length && <p className="empty">等待第一条请求进入路由器。</p>}
      </div>
    </section>
  )
}

function ProviderEditor({
  provider,
  providerStatus,
  selected,
  onSelect,
  onDelete,
  onChange,
}: {
  provider: Provider
  providerStatus?: ProviderStatus
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onChange: (patch: Partial<Provider>) => void
}) {
  const latencyLabel = providerStatus?.latencyMs ? formatMs(providerStatus.latencyMs) : '离线'
  const stateLabel = provider.enabled ? providerStatus?.online ? '在线' : '已启用' : '停用'
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <Card className={`provider-card ${provider.enabled ? 'enabled' : ''} ${selected ? 'selected' : ''}`}>
      <button className="provider-card-summary" type="button" onClick={onSelect} aria-expanded={selected}>
        <span className="provider-grip" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="provider-avatar">{provider.name.trim().slice(0, 2).toUpperCase() || 'AI'}</span>
        <span className="provider-identity">
          <strong>{provider.name || '未命名 Provider'}</strong>
          <small>{provider.baseUrl || '未配置 Base URL'}</small>
        </span>
        <span className="provider-row-meta">
          <span><b>{latencyLabel}</b> Latency</span>
          <span><b>{providerStatus?.requests ?? 0}</b> Requests</span>
          <span><b>{providerStatus?.failures ?? 0}</b> Failures</span>
        </span>
        <span className={`provider-state ${providerStatus?.online ? 'online' : ''}`}>
          {selected && <Check size={13} />}
          {stateLabel}
        </span>
      </button>

      {selected && (
        <div className="provider-expanded">
          <div className="provider-card-head">
            <div>
              <span className={providerStatus?.online ? 'dot online' : 'dot'} />
              <strong>服务商配置</strong>
            </div>
            <div className="provider-actions">
              <Switch checked={provider.enabled} title="启用服务商" onCheckedChange={(checked) => onChange({ enabled: checked })} />
              <Button className="provider-delete" variant="ghost" type="button" onClick={onDelete} title="删除服务商">
                <Trash2 size={15} />
                删除
              </Button>
            </div>
          </div>
          <div className="provider-fields">
            <label className="field">
              名称
              <input value={provider.name} onChange={(event) => onChange({ name: event.target.value })} />
            </label>
            <label className="field">
              Base URL
              <input value={provider.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} />
            </label>
            <div className="provider-secret">
              <KeyRound size={16} />
              <input
                aria-label="API Key"
                type={showApiKey ? 'text' : 'password'}
                placeholder="API Key"
                value={provider.apiKey}
                onChange={(event) => onChange({ apiKey: event.target.value })}
              />
              <Button
                className="secret-visibility"
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => setShowApiKey((value) => !value)}
                title={showApiKey ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </Button>
            </div>
            <div className="provider-tunables">
              <NumberField label="优先级" value={provider.priority} onChange={(value) => onChange({ priority: value })} />
              <NumberField label="权重" value={provider.weight} onChange={(value) => onChange({ weight: value })} />
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function ConfirmActionDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const isDelete = action?.kind === 'delete-provider'
  const providerName = isDelete ? action.provider.name || '未命名 Provider' : ''

  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => {
      if (!open) onCancel()
    }}>
      <DialogContent className="confirm-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{isDelete ? '删除服务商' : '添加服务商'}</DialogTitle>
          <DialogDescription>
            {isDelete
              ? `确认删除「${providerName}」？相关路由规则绑定也会一并移除。`
              : '确认添加一个新的服务商？添加后会自动展开配置。'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="confirm-dialog-footer">
          <Button variant="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button className={isDelete ? 'confirm-danger' : undefined} type="button" onClick={onConfirm}>
            {isDelete ? '删除' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      {label}
      <input min={0} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function UsageTable({ logs }: { logs: GatewayStatus['logs'] }) {
  return (
    <ScrollArea className="usage-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>API 密钥</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>中转站</TableHead>
            <TableHead>端点</TableHead>
            <TableHead>类型</TableHead>
            <TableHead className="numeric">Token</TableHead>
            <TableHead className="numeric">费用</TableHead>
            <TableHead className="numeric">耗时</TableHead>
            <TableHead>时间</TableHead>
            <TableHead>User-Agent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.slice(0, 80).map((log) => (
            <TableRow key={`${log.id}-${log.retry}-${log.provider}`}>
              <TableCell>{log.apiKeyName}</TableCell>
              <TableCell><strong>{log.model}</strong></TableCell>
              <TableCell>{log.provider}</TableCell>
              <TableCell>{log.path.replace('/v1', '')}</TableCell>
              <TableCell><em>{log.stream ? '流式' : '非流式'}</em></TableCell>
              <TableCell className="numeric token-cell">
                <b>↓ {log.promptTokens.toLocaleString()}</b>
                <b>↑ {log.completionTokens.toLocaleString()}</b>
                {Boolean(log.cachedTokens) && <small>R {formatToken(log.cachedTokens ?? 0)}</small>}
                <small>Σ {formatToken(log.totalTokens)}</small>
              </TableCell>
              <TableCell className="numeric cost">{formatUsd(log.costUsd)}</TableCell>
              <TableCell className="numeric">{formatMs(log.latencyMs)}</TableCell>
              <TableCell><time>{formatTime(log.at)}</time></TableCell>
              <TableCell><span className="user-agent">{log.userAgent || '未知'}</span></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!logs.length && <p className="empty">暂无请求记录。</p>}
    </ScrollArea>
  )
}

function viewTitle(view: ViewId) {
  const titles: Record<ViewId, string> = {
    overview: '运行概览',
    providers: '服务商管理',
    rules: '路由与熔断',
    pricing: '模型定价',
    test: '请求测试',
    logs: '请求日志',
    settings: '设置',
  }
  return titles[view]
}

function strategyLabel(strategy: GatewayConfig['strategy']) {
  const labels: Record<GatewayConfig['strategy'], string> = {
    priority: '优先级',
    'stable-priority': '稳定优先',
    fastest: '最快优先',
    'round-robin': '轮询',
    weighted: '权重',
  }
  return labels[strategy]
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
  return `$${value.toFixed(6)}`
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

function statusOk(status: number | string) {
  if (typeof status === 'number') return status >= 200 && status < 400
  return status.startsWith('2') || status === 'ok'
}

function adminUrl(path: string) {
  return `${adminBaseUrl}${path}`
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
        if (content && typeof content === 'object' && 'text' in content) {
          const text = content.text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
    })
    .join('')
}

export default App
