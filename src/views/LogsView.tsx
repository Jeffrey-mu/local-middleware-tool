import { UsageTable } from '../components/dashboard/UsageTable'
import type { GatewayStatus } from '../types'

type LogsViewProps = {
  logs: GatewayStatus['logs']
}

export function LogsView({ logs }: LogsViewProps) {
  return (
<section className="panel usage-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">使用记录</p>
                <h3>最近请求</h3>
              </div>
            </div>
            <UsageTable logs={logs} />
          </section>
  )
}
