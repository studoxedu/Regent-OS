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

/** The standard Nigerian K-12 stages, in order. */
export const STANDARD_K12_STAGES: string[] = ['nursery', 'primary', 'jss', 'sss']

/** Label for any stage, including school-defined ones (e.g. Islamiyya "raudah"). */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return ''
  return (STAGE_LABELS as Record<string, string>)[stage]
    ?? stage.charAt(0).toUpperCase() + stage.slice(1)
}

type ClassLike = { id: string; name: string; stage: string; next_class_id?: string | null }

/** Classes in progression order: follows each class's next_class_id chain from
 *  the entry class onward; standard-stage schools fall back to stage order. */
export function sortClassesByProgression<T extends ClassLike>(classes: T[]): T[] {
  const byId = new Map(classes.map(c => [c.id, c]))
  const pointedTo = new Set(classes.map(c => c.next_class_id).filter(Boolean) as string[])
  const stdIdx = (s: string) => {
    const i = STANDARD_K12_STAGES.indexOf(s)
    return i === -1 ? 99 : i
  }
  const heads = classes
    .filter(c => !pointedTo.has(c.id))
    .sort((a, b) => stdIdx(a.stage) - stdIdx(b.stage) || a.name.localeCompare(b.name))
  const out: T[] = []
  const seen = new Set<string>()
  for (const head of heads) {
    let cur: T | undefined = head
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id); out.push(cur)
      cur = cur.next_class_id ? byId.get(cur.next_class_id) : undefined
    }
  }
  for (const c of classes) if (!seen.has(c.id)) out.push(c)  // cycles / leftovers
  return out
}

/** The stages a K-12 school actually uses, taken from its own classes in
 *  progression order. Schools with no classes yet get the standard stages. */
export function schoolStages(classes: ClassLike[]): string[] {
  if (classes.length === 0) return [...STANDARD_K12_STAGES]
  const stages: string[] = []
  for (const c of sortClassesByProgression(classes)) {
    if (c.stage && !stages.includes(c.stage)) stages.push(c.stage)
  }
  // Standard schools: keep the familiar nursery → sss order and full list
  if (stages.every(s => STANDARD_K12_STAGES.includes(s))) return [...STANDARD_K12_STAGES]
  return stages
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

export interface GradeBand {
  min_score: number
  max_score: number
  grade: string
  grade_point: number
  description?: string | null
}

const DEFAULT_REMARKS: Record<string, string> = {
  A: 'Excellent', B: 'Very Good', C: 'Good', D: 'Credit', E: 'Pass', F: 'Fail',
}

/** Grade a score with the school's own grading scale (grade_scales).
 *  Returns null when the school has no scale, so callers keep their default. */
export function gradeFromBands(
  total: number, bands: GradeBand[],
): { grade: string; point: number; remark: string } | null {
  if (!bands.length) return null
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score)
  const band = sorted.find(b => total >= b.min_score) ?? sorted[sorted.length - 1]
  return {
    grade: band.grade,
    point: Number(band.grade_point),
    remark: band.description || DEFAULT_REMARKS[band.grade] || '',
  }
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
