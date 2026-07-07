import { ChevronRight, Monitor, Moon, Sun } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import type { ThemeMode } from '../types'

export function SettingsView({
  themeMode,
  onBack,
  onThemeModeChange,
}: {
  themeMode: ThemeMode
  onBack: () => void
  onThemeModeChange: (themeMode: ThemeMode) => void
}) {
  return (
    <section className="settings-page">
      <div className="settings-page-head">
        <button className="settings-back" type="button" onClick={onBack} title="返回">
          <ChevronRight size={18} />
        </button>
        <h3>设置</h3>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button className="active" type="button">通用</button>
        <button type="button">路由</button>
        <button type="button">认证</button>
        <button type="button">高级</button>
        <button type="button">使用统计</button>
        <button type="button">关于</button>
      </div>

      <div className="settings-sections">
        <section className="settings-section">
          <div className="settings-section-copy">
            <strong>外观主题</strong>
            <span>选择 AIGate 在桌面环境中的显示方式。</span>
          </div>
          <ToggleGroup
            className="theme-toggle"
            size="sm"
            spacing={1}
            type="single"
            value={themeMode}
            onValueChange={(value) => {
              if (value === 'system' || value === 'dark' || value === 'light') onThemeModeChange(value)
            }}
          >
            <ToggleGroupItem value="light">
              <Sun size={15} />
              浅色
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              <Moon size={15} />
              深色
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
              <Monitor size={15} />
              跟随系统
            </ToggleGroupItem>
          </ToggleGroup>
        </section>

        <section className="settings-section">
          <div className="settings-section-copy">
            <strong>滚动条</strong>
            <span>侧栏固定，日志和表格只在内容区内部滚动。</span>
          </div>
          <span className="setting-state">已优化</span>
        </section>
      </div>
    </section>
  )
}
