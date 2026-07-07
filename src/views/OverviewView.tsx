import { Activity, BarChart3, Check, ChevronRight, Clock, Database, DollarSign, Server } from 'lucide-react'
import { Button } from '../components/ui/button'
import { EventTimeline } from '../components/dashboard/EventTimeline'
import { Metric, PanelTitle } from '../components/dashboard/common'
import { RouteFlow } from '../components/dashboard/RouteFlow'
import { barWidth, formatMs, formatToken, formatUsd, strategyLabel } from '../lib/format'
import type { GatewayStatus, Provider, ProviderStatus } from '../types'

type OverviewViewProps = {
  status: GatewayStatus
  config: GatewayStatus['config']
  endpoint: string
  analytics: GatewayStatus['analytics']
  successRate: string
  enabledProviders: number
  activeProvider?: Provider
  backupProviders: Provider[]
  latestLog?: GatewayStatus['logs'][number]
  statusByProvider: Map<string, ProviderStatus>
  onOpenTest: () => void
}

export function OverviewView({ status, config, endpoint, analytics, successRate, enabledProviders, activeProvider, backupProviders, latestLog, statusByProvider, onOpenTest }: OverviewViewProps) {
  return (
<section className="view-stack">
            <div className="control-hero">
              <div className="control-copy">
                <span className="status-pill"><span className="live-dot" /> Middleware Running</span>
                <h3>{enabledProviders ? '本地 AI 流量正在被接管' : '启用一个 Provider 后开始接管流量'}</h3>
                <p>{endpoint} · {strategyLabel(config.strategy)} · {status.metrics.onlineProviders} 个在线 Provider</p>
              </div>
              <Button type="button" onClick={() => onOpenTest()}>
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
  )
}
