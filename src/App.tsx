import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Check,
  Clipboard,
  DollarSign,
  Gauge,
  MessageSquareText,
  Route,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { ConfirmActionDialog } from './components/dashboard/ConfirmActionDialog'
import { LogsView } from './views/LogsView'
import { OverviewView } from './views/OverviewView'
import { PricingView } from './views/PricingView'
import { ProvidersView } from './views/ProvidersView'
import { RulesView } from './views/RulesView'
import { SettingsView } from './views/SettingsView'
import { TestView } from './views/TestView'
import { adminUrl } from './lib/api'
import { formatToken, viewTitle } from './lib/format'
import { extractResponseText, readResponseStream } from './lib/responses'
import type { ChatMessage, ConfirmAction, GatewayConfig, GatewayStatus, ModelPricing, PricingTable, Provider, ThemeMode, ViewId } from './types'
import './App.css'

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
  const navItems: Array<{ id: ViewId; label: string; icon: ReactNode; meta: string }> = [
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
          <OverviewView
            status={status}
            config={config}
            endpoint={endpoint}
            analytics={analytics}
            successRate={successRate}
            enabledProviders={enabledProviders}
            activeProvider={activeProvider}
            backupProviders={backupProviders}
            latestLog={latestLog}
            statusByProvider={statusByProvider}
            onOpenTest={() => setActiveView('test')}
          />
        )}

        {activeView === 'providers' && (
          <ProvidersView
            config={config}
            checking={checking}
            selectedProviderId={selectedProviderId}
            statusByProvider={statusByProvider}
            onHealthCheck={healthCheck}
            onRequestAddProvider={requestAddProvider}
            onSelectProvider={setSelectedProviderId}
            onRequestRemoveProvider={requestRemoveProvider}
            onUpdateProvider={updateProvider}
          />
        )}

        {activeView === 'rules' && (
          <RulesView config={config} onUpdateConfig={updateConfig} />
        )}

        {activeView === 'test' && (
          <TestView
            chatInput={chatInput}
            chatModel={chatModel}
            chatStream={chatStream}
            chatRunning={chatRunning}
            chatMessages={chatMessages}
            modelOptions={modelOptions}
            onChatInputChange={setChatInput}
            onChatModelChange={setChatModel}
            onToggleStream={() => setChatStream((value) => !value)}
            onSendTestMessage={sendTestMessage}
            onStopChat={stopChat}
          />
        )}

        {activeView === 'pricing' && (
          <PricingView
            pricing={pricing}
            pricingSaving={pricingSaving}
            onAddPricingRow={addPricingRow}
            onSavePricing={savePricing}
            onUpdatePricingRow={updatePricingRow}
            onRemovePricingRow={removePricingRow}
          />
        )}

        {activeView === 'logs' && (
          <LogsView logs={status.logs} />
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

  async function sendTestMessage(event: FormEvent<HTMLFormElement>) {
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

export default App
