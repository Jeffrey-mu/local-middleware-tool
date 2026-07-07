import { Clock } from 'lucide-react'
import type { GatewayStatus } from '../../types'
import { formatMs, formatTime, statusOk } from '../../lib/format'
import { PanelTitle } from './common'

export function EventTimeline({ logs }: { logs: GatewayStatus['logs'] }) {
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
