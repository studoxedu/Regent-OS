import { cn } from '../../lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  className?: string
  children: ReactNode
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-lg shadow-card overflow-hidden', className)}>
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  meta?: string
  action?: ReactNode
  className?: string
}

export function CardHeader({ title, meta, action, className }: CardHeaderProps) {
  return (
    <div className={cn(
      'px-5 py-3.5 border-b border-gray-200 flex items-center justify-between',
      className
    )}>
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold text-navy-900">{title}</span>
        {meta && <span className="text-xs text-gray-400">{meta}</span>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'amber' | 'green' | 'yellow' | 'red' | 'blue'
}

const accentClass: Record<string, string> = {
  amber:  'border-t-2 border-t-amber-500',
  green:  'border-t-2 border-t-green-600',
  yellow: 'border-t-2 border-t-yellow-500',
  red:    'border-t-2 border-t-red-600',
  blue:   'border-t-2 border-t-blue-600',
}

export function StatCard({ label, value, sub, accent = 'amber' }: StatCardProps) {
  return (
    <div className={cn(
      'bg-white border border-gray-200 rounded-lg shadow-card p-5',
      accentClass[accent]
    )}>
      <div className="label mb-2.5">{label}</div>
      <div className="text-[26px] font-bold text-navy-900 leading-none">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1.5">{sub}</div>}
    </div>
  )
}

interface AlertProps {
  type: 'info' | 'warning' | 'danger' | 'success'
  children: ReactNode
  className?: string
}

const alertStyles: Record<string, string> = {
  info:    'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  danger:  'bg-red-50 border-red-200 text-red-800',
  success: 'bg-green-50 border-green-200 text-green-800',
}

const alertIcons: Record<string, string> = {
  info: 'i', warning: '!', danger: '×', success: '+'
}

export function Alert({ type, children, className }: AlertProps) {
  return (
    <div className={cn(
      'border rounded-md px-4 py-3 flex gap-2.5 items-start text-sm',
      alertStyles[type], className
    )}>
      <span className="flex-shrink-0 mt-0.5 font-bold">{alertIcons[type]}</span>
      <div>{children}</div>
    </div>
  )
}
