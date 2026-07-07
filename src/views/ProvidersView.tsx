import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ProviderEditor } from '../components/dashboard/ProviderEditor'
import type { GatewayConfig, Provider, ProviderStatus } from '../types'

type ProvidersViewProps = {
  config: GatewayConfig
  checking: boolean
  selectedProviderId: string | null
  statusByProvider: Map<string, ProviderStatus>
  onHealthCheck: () => void
  onRequestAddProvider: () => void
  onSelectProvider: (providerId: string) => void
  onRequestRemoveProvider: (index: number) => void
  onUpdateProvider: (index: number, patch: Partial<Provider>) => void
}

export function ProvidersView({ config, checking, selectedProviderId, statusByProvider, onHealthCheck, onRequestAddProvider, onSelectProvider, onRequestRemoveProvider, onUpdateProvider }: ProvidersViewProps) {
  return (
<section className="panel provider-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">服务商</p>
                <h3>路由池</h3>
              </div>
              <div className="actions">
                <Button variant="secondary" type="button" onClick={onHealthCheck} disabled={checking}>
                  <RefreshCw size={16} />
                  {checking ? '检测中' : '检测'}
                </Button>
                <Button type="button" onClick={onRequestAddProvider}>
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
                    onSelect={() => onSelectProvider(provider.id)}
                    onDelete={() => onRequestRemoveProvider(index)}
                    onChange={(patch) => onUpdateProvider(index, patch)}
                  />
                )
              })}
            </div>
          </section>
  )
}
