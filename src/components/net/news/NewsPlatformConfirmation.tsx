import { ShieldCheck, X } from 'lucide-react'

import { useNetDialog } from '../netDialogStack'

export function NewsPlatformConfirmation({
  className,
  dialogClassName,
  title,
  body,
  confirmLabel,
  tone = 'default',
  onCancel,
  onConfirm,
}: {
  readonly className: string
  readonly dialogClassName?: string
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly tone?: 'default' | 'danger'
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { dialogRef, onFocusCapture } = useNetDialog<HTMLDivElement>(onCancel)
  return (
    <div className={className} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className={dialogClassName} role="alertdialog" aria-modal="true" aria-labelledby="news-platform-confirm-title" tabIndex={-1} onFocusCapture={onFocusCapture}>
        <header><ShieldCheck size={17} aria-hidden="true" /><strong id="news-platform-confirm-title">{title}</strong><button type="button" aria-label="Close confirmation" onClick={onCancel}><X size={15} aria-hidden="true" /></button></header>
        <p>{body}</p>
        <footer><button type="button" data-net-dialog-initial-focus onClick={onCancel}>Cancel</button><button type="button" data-tone={tone} onClick={onConfirm}>{confirmLabel}</button></footer>
      </div>
    </div>
  )
}
