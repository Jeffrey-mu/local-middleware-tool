import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import type { ConfirmAction } from '../../types'

export function ConfirmActionDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const isDelete = action?.kind === 'delete-provider'
  const providerName = isDelete ? action.provider.name || '未命名 Provider' : ''

  return (
    <Dialog open={Boolean(action)} onOpenChange={(open) => {
      if (!open) onCancel()
    }}>
      <DialogContent className="confirm-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{isDelete ? '删除服务商' : '添加服务商'}</DialogTitle>
          <DialogDescription>
            {isDelete
              ? `确认删除「${providerName}」？相关路由规则绑定也会一并移除。`
              : '确认添加一个新的服务商？添加后会自动展开配置。'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="confirm-dialog-footer">
          <Button variant="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button className={isDelete ? 'confirm-danger' : undefined} type="button" onClick={onConfirm}>
            {isDelete ? '删除' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
