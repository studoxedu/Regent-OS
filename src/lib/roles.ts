// Central K-12 office definitions — kept in one place so routing,
// sidebar filtering, and onboarding dropdowns never drift apart.
//
// exam_officer / registrar already exist as *tertiary* office names
// (and offices.name is UNIQUE), so K-12 uses the k12_ prefix to stay
// distinct and to route correctly (routing keys off the office name).

export const K12_OFFICES = [
  'head_teacher',
  'class_teacher',
  'bursar',
  'k12_exam_officer',
  'k12_registrar',
] as const

export type K12Office = typeof K12_OFFICES[number]

export const K12_OFFICE_LABELS: Record<string, string> = {
  head_teacher:     'Head Teacher / Principal',
  class_teacher:    'Class Teacher',
  bursar:           'Bursar / Finance Officer',
  k12_exam_officer: 'Exam Officer',
  k12_registrar:    'Admissions & Records',
}

export function isK12Office(name: string): boolean {
  return (K12_OFFICES as readonly string[]).includes(name)
}

// Office → which sidebar section keys it may see.
// null (or an office not listed) = full access, used for the Head
// Teacher / Principal who retains oversight of every section.
export const K12_OFFICE_SECTIONS: Record<string, string[] | null> = {
  head_teacher:     null,
  class_teacher:    ['overview', 'academics', 'resources'],
  bursar:           ['overview', 'finance', 'resources'],
  k12_exam_officer: ['overview', 'academics', 'resources'],
  k12_registrar:    ['overview', 'admissions', 'resources'],
}
