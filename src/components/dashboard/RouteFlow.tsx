import { Network, Server, Sparkles, Zap } from 'lucide-react'
import type { GatewayConfig, GatewayStatus, Provider, ProviderStatus } from '../../types'
import { formatMs, strategyLabel } from '../../lib/format'
import { PanelTitle } from './common'

export function RouteFlow({
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
