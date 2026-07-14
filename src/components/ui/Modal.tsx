import { useEffect, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}

export function Modal({ open, title, onClose, children, footer, width = 'max-w-md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-[2px]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={cn(
        'bg-white rounded-lg shadow-modal w-full mx-4 overflow-hidden',
        width
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-[15px] font-bold text-navy-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer bg-none border-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  open: boolean
  title: string
  message: ReactNode
  warning?: string
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger' | 'amber'
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}

export function ConfirmModal({
  open, title, message, warning, confirmLabel = 'Confirm',
  confirmVariant = 'primary', onConfirm, onClose, loading
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>
            {loading ? 'Processing…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-gray-700 mb-4">{message}</div>
      {warning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-sm px-3 py-2.5 text-xs text-yellow-800">
          {warning}
        </div>
      )}
    </Modal>
  )
}
