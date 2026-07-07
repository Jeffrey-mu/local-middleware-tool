import { Settings } from 'lucide-react'
import { PanelTitle } from '../components/dashboard/common'
import { NumberField } from '../components/dashboard/NumberField'
import type { GatewayConfig } from '../types'

type RulesViewProps = {
  config: GatewayConfig
  onUpdateConfig: (config: GatewayConfig) => void
}

export function RulesView({ config, onUpdateConfig }: RulesViewProps) {
  return (
<section className="settings-grid">
            <div className="panel">
              <PanelTitle eyebrow="网关" title="路由设置" icon={<Settings size={18} />} />
              <label className="field">
                路由策略
                <select value={config.strategy} onChange={(event) => onUpdateConfig({ ...config, strategy: event.target.value as GatewayConfig['strategy'] })}>
                  <option value="priority">优先级</option>
                  <option value="stable-priority">稳定优先</option>
                  <option value="fastest">最快优先</option>
                  <option value="round-robin">轮询</option>
                  <option value="weighted">权重</option>
                </select>
              </label>
              <NumberField label="最大重试次数" value={config.maxRetries} onChange={(value) => onUpdateConfig({ ...config, maxRetries: value })} />
              <NumberField
                label="熔断阈值"
                value={config.circuitBreaker.failureThreshold}
                onChange={(value) => onUpdateConfig({ ...config, circuitBreaker: { ...config.circuitBreaker, failureThreshold: value } })}
              />
              <NumberField
                label="熔断冷却毫秒"
                value={config.circuitBreaker.cooldownMs}
                onChange={(value) => onUpdateConfig({ ...config, circuitBreaker: { ...config.circuitBreaker, cooldownMs: value } })}
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
  )
}
