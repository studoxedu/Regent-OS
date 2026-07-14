import { cn } from '../../lib/utils'
import type { ResultStatus, EnrollmentStatus } from '../../types'
import { RESULT_STATUS_STYLES, ENROLLMENT_STATUS_STYLES } from '../../lib/utils'

interface BadgeProps {
  label: string
  bg?: string
  text?: string
  dot?: string
  className?: string
}

export function Badge({ label, bg = 'bg-gray-100', text = 'text-gray-600', dot, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
      'text-[10px] font-bold tracking-[0.05em] uppercase',
      bg, text, className
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dot)} />}
      {label}
    </span>
  )
}

export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  const s = RESULT_STATUS_STYLES[status]
  return <Badge label={status} bg={s.bg} text={s.text} dot={s.dot} />
}

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  const s = ENROLLMENT_STATUS_STYLES[status]
  return <Badge label={status} bg={s.bg} text={s.text} dot={s.dot} />
}

export function StageBadge({ stage }: { stage: string }) {
  const tertiary = ['nd', 'hnd', 'nce', 'degree']
  const isTertiary = tertiary.includes(stage)
  return (
    <Badge
      label={stage.toUpperCase()}
      bg={isTertiary ? 'bg-navy-900' : 'bg-gray-100'}
      text={isTertiary ? 'text-navy-200' : 'text-gray-600'}
    />
  )
}

export function TierBadge({ tier }: { tier: 'pilot' | 'standard' }) {
  return tier === 'standard'
    ? <Badge label="Standard — Paid" bg="bg-amber-500" text="text-white" />
    : <Badge label="Pilot — Free" bg="bg-gray-100" text="text-gray-500" />
}
