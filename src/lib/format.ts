import type { GatewayConfig, ViewId } from '../types'

export function viewTitle(view: ViewId) {
  const titles: Record<ViewId, string> = {
    overview: '运行概览',
    providers: '服务商管理',
    rules: '路由与熔断',
    pricing: '模型定价',
    test: '请求测试',
    logs: '请求日志',
    settings: '设置',
  }
  return titles[view]
}

export function strategyLabel(strategy: GatewayConfig['strategy']) {
  const labels: Record<GatewayConfig['strategy'], string> = {
    priority: '优先级',
    'stable-priority': '稳定优先',
    fastest: '最快优先',
    'round-robin': '轮询',
    weighted: '权重',
  }
  return labels[strategy]
}

export function formatToken(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function formatMs(value: number) {
  if (!value) return '0ms'
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  return `${Math.round(value)}ms`
}

export function formatUsd(value: number) {
  return `$${value.toFixed(6)}`
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function barWidth(value: number, total: number) {
  if (!total) return 0
  return Math.max(6, Math.round((value / total) * 100))
}

export function statusOk(status: number | string) {
  if (typeof status === 'number') return status >= 200 && status < 400
  return status.startsWith('2') || status === 'ok'
}
