import { useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Switch } from '../ui/switch'
import type { Provider, ProviderStatus } from '../../types'
import { formatMs } from '../../lib/format'
import { NumberField } from './NumberField'

export function ProviderEditor({
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
