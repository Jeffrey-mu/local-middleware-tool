import { ScrollArea } from '../ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { GatewayStatus } from '../../types'
import { formatMs, formatTime, formatToken, formatUsd } from '../../lib/format'

export function UsageTable({ logs }: { logs: GatewayStatus['logs'] }) {
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
