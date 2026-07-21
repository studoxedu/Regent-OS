import type { Stage, GovernanceMode, ResultStatus, EnrollmentStatus } from '../types'

/** Derive governance mode from an array of stages. */
export function governanceModeFromStages(stages: Stage[]): GovernanceMode[] {
  const modes: GovernanceMode[] = []
  const k12Stages: Stage[] = ['nursery', 'primary', 'jss', 'sss']
  const tertiaryStages: Stage[] = ['nd', 'hnd', 'nce', 'degree']
  if (stages.some(s => k12Stages.includes(s))) modes.push('k12')
  if (stages.some(s => tertiaryStages.includes(s))) modes.push('tertiary')
  return modes
}

/** Human-readable stage label. */
export const STAGE_LABELS: Record<Stage, string> = {
  nursery: 'Nursery', primary: 'Primary',
  jss: 'JSS', sss: 'SSS',
  nd: 'ND', hnd: 'HND', nce: 'NCE', degree: 'Degree',
}

/** Colour config for result pipeline status badges. */
export const RESULT_STATUS_STYLES: Record<
  ResultStatus,
  { bg: string; text: string; dot: string }
> = {
  draft:            { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
  submitted:        { bg: 'bg-blue-100',   text: 'text-blue-700',    dot: 'bg-blue-500' },
  dept_verified:    { bg: 'bg-cyan-100',   text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  dept_approved:    { bg: 'bg-yellow-100', text: 'text-yellow-800',  dot: 'bg-yellow-400' },
  faculty_verified: { bg: 'bg-violet-100', text: 'text-violet-700',  dot: 'bg-violet-500' },
  published:        { bg: 'bg-green-100',  text: 'text-green-700',   dot: 'bg-green-500' },
}

// Human-readable labels for the tertiary results pipeline states.
export const RESULT_STATUS_LABELS: Record<string, string> = {
  draft:            'Draft',
  submitted:        'Submitted',
  dept_verified:    'Dept Verified',
  dept_approved:    'Dept Approved',
  faculty_verified: 'Faculty Verified',
  published:        'Published',
}

/** Colour config for enrollment status badges. */
export const ENROLLMENT_STATUS_STYLES: Record<
  EnrollmentStatus,
  { bg: string; text: string; dot: string }
> = {
  active:      { bg: 'bg-green-100',  text: 'text-green-700',   dot: 'bg-green-500' },
  transferred: { bg: 'bg-purple-100', text: 'text-purple-700',  dot: 'bg-purple-500' },
  graduated:   { bg: 'bg-yellow-50',  text: 'text-yellow-800',  dot: 'bg-yellow-400' },
  withdrawn:   { bg: 'bg-red-100',    text: 'text-red-700',     dot: 'bg-red-500' },
}

/** Format a Naira amount */
export function formatNaira(amount: number): string {
  return '₦' + new Intl.NumberFormat('en-NG').format(amount)
}

/** Format an ISO date string to readable form */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

/** Format ISO datetime */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Compute grade from total score using a simple 5.0-scale default */
export function computeGrade(total: number): { grade: string; point: number } {
  if (total >= 70) return { grade: 'A', point: 5.0 }
  if (total >= 60) return { grade: 'B', point: 4.0 }
  if (total >= 50) return { grade: 'C', point: 3.0 }
  if (total >= 45) return { grade: 'D', point: 2.0 }
  if (total >= 40) return { grade: 'E', point: 1.0 }
  return { grade: 'F', point: 0.0 }
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
