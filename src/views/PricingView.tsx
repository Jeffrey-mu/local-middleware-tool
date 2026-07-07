import { Plus, Save } from 'lucide-react'
import { Button } from '../components/ui/button'
import { formatTime } from '../lib/format'
import type { ModelPricing, PricingTable } from '../types'

type PricingViewProps = {
  pricing: PricingTable
  pricingSaving: boolean
  onAddPricingRow: () => void
  onSavePricing: () => void
  onUpdatePricingRow: (index: number, patch: Partial<ModelPricing>) => void
  onRemovePricingRow: (index: number) => void
}

export function PricingView({ pricing, pricingSaving, onAddPricingRow, onSavePricing, onUpdatePricingRow, onRemovePricingRow }: PricingViewProps) {
  return (
<section className="panel pricing-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">本地存储</p>
                <h3>模型定价</h3>
              </div>
              <div className="actions">
                <Button variant="secondary" type="button" onClick={onAddPricingRow}>
                  <Plus size={16} />
                  添加模型
                </Button>
                <Button type="button" onClick={onSavePricing} disabled={pricingSaving}>
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
                    onChange={(event) => onUpdatePricingRow(index, { model: event.target.value })}
                  />
                  <input
                    aria-label="输入价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.inputUsdPerMillion}
                    onChange={(event) => onUpdatePricingRow(index, { inputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="缓存输入价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.cachedInputUsdPerMillion}
                    onChange={(event) => onUpdatePricingRow(index, { cachedInputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="输出价格"
                    min={0}
                    step="0.000001"
                    type="number"
                    value={item.outputUsdPerMillion}
                    onChange={(event) => onUpdatePricingRow(index, { outputUsdPerMillion: Number(event.target.value) })}
                  />
                  <input
                    aria-label="来源"
                    value={item.source}
                    onChange={(event) => onUpdatePricingRow(index, { source: event.target.value })}
                  />
                  <div className="pricing-meta">
                    <time>{item.updatedAt ? formatTime(item.updatedAt) : '未保存'}</time>
                    <Button className="text-action" variant="ghost" type="button" onClick={() => onRemovePricingRow(index)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              {!pricing.models.length && <p className="empty">暂无模型定价。添加后，费用统计会按这里的价格重新用于新请求。</p>}
            </div>
          </section>
  )
}
