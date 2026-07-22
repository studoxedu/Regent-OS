// Central K-12 office definitions — kept in one place so routing,
// sidebar filtering, route-guarding and onboarding dropdowns never drift.
//
// exam_officer / registrar already exist as *tertiary* office names
// (and offices.name is UNIQUE), so K-12 uses the k12_ prefix to stay
// distinct and to route correctly (routing keys off the office name).

export const K12_OFFICES = [
  'head_teacher',
  'ict_admin',
  'class_teacher',
  'bursar',
  'k12_exam_officer',
  'k12_registrar',
] as const

export type K12Office = typeof K12_OFFICES[number]

export const K12_OFFICE_LABELS: Record<string, string> = {
  head_teacher:     'Head Teacher / Principal',
  ict_admin:        'ICT / Access Administrator',
  class_teacher:    'Class Teacher',
  bursar:           'Bursar / Finance Officer',
  k12_exam_officer: 'Exam Officer',
  k12_registrar:    'Admissions & Records',
}

export function isK12Office(name: string): boolean {
  return (K12_OFFICES as readonly string[]).includes(name)
}

// ── Route-level access control (the real UI scoping) ───────────────────────
// Per office: the exact set of K-12 routes it may open. This single map drives
// BOTH the sidebar (which items show) and the route guard (URL-typing is
// blocked). Enforcement is defence-in-depth — the database RLS + flow_execute
// capability checks are the hard wall; this keeps users out of pages they
// can't use.
//
// Notes on the model:
//  • Head Teacher sees everything EXCEPT /k12/results — they oversee and VIEW
//    grades (report cards) but do not ENTER scores (separation of duties).
//  • ICT Admin = school access administrator: setup, admissions, guardians,
//    attendance, timetable, CBT, staff records, library — but NOT finance
//    (fees/payroll) and NOT grading (results / report cards).
//  • Score entry (/k12/results) belongs to Exam Officer + Class Teacher only.
const OVERVIEW  = ['/k12', '/k12/audit']
const RESOURCES = ['/k12/library', '/k12/announcements', '/k12/messages']

export const K12_OFFICE_ROUTES: Record<string, string[]> = {
  // Broad roles — Head Teacher (all except score entry) and ICT Admin (all
  // except finance + grading). These two are the only wide-access offices.
  head_teacher: [
    ...OVERVIEW,
    '/k12/school', '/k12/calendar', '/k12/classes',
    '/k12/enrollment', '/k12/guardians', '/k12/transfers', '/k12/promotion',
    '/k12/attendance', '/k12/report-cards', '/k12/timetable', '/k12/cbt',
    '/k12/fee-management', '/k12/fees', '/k12/payroll', '/k12/staff',
    ...RESOURCES,
  ],
  ict_admin: [
    ...OVERVIEW,
    '/k12/school', '/k12/calendar', '/k12/classes',
    '/k12/enrollment', '/k12/guardians', '/k12/transfers', '/k12/promotion',
    '/k12/attendance', '/k12/timetable', '/k12/cbt', '/k12/staff',
    ...RESOURCES,
  ],

  // Tightly-scoped single-purpose roles: their function + Announcements only.
  // No Overview/Dashboard, no Library/Messages.
  k12_exam_officer: [
    // Academics + Announcements
    '/k12/attendance', '/k12/results', '/k12/report-cards', '/k12/timetable', '/k12/cbt',
    '/k12/announcements',
  ],
  bursar: [
    // Finance + HR + Announcements
    '/k12/fee-management', '/k12/fees', '/k12/payroll', '/k12/staff',
    '/k12/announcements',
  ],
  k12_registrar: [
    // Admissions & Records + Announcements
    '/k12/enrollment', '/k12/guardians', '/k12/transfers', '/k12/promotion',
    '/k12/announcements',
  ],
  class_teacher: [
    // Attendance, Results entry, CBT + Announcements
    '/k12/attendance', '/k12/results', '/k12/cbt',
    '/k12/announcements',
  ],
}

/** May this K-12 office open this pathname? Unknown offices are allowed
 *  (fail-open) so a new/unmapped role is never hard-locked out of the app;
 *  the database still enforces what they can actually write. */
export function k12RouteAllowed(officeName: string, pathname: string): boolean {
  const allowed = K12_OFFICE_ROUTES[officeName]
  if (!allowed) return true
  return allowed.includes(pathname)
}

/** Where a K-12 office should land — its first allowed route. Prevents a
 *  redirect loop for tightly-scoped roles whose allowlist excludes the
 *  /k12 dashboard. */
export function k12DefaultRoute(officeName: string): string {
  const allowed = K12_OFFICE_ROUTES[officeName]
  return allowed && allowed.length > 0 ? allowed[0] : '/k12'
}

/** Offices that may assign users to roles / create staff + parents. Mirrors
 *  the DB capability `staff.assign_role`; used to show the UI affordance. */
export function canAssignRoles(officeName: string): boolean {
  return officeName === 'head_teacher' || officeName === 'ict_admin'
}

/** Offices that may edit salary grades (a financial record). Mirrors the DB
 *  capability `salary.manage`. */
export function canManageSalary(officeName: string): boolean {
  return officeName === 'head_teacher' || officeName === 'bursar'
}

// Client-side capability check — drives write-control visibility so a role only
// sees buttons for actions it can actually perform (the DB still enforces it).
export const hasCap = (appUser: { capabilities?: string[] }, action: string): boolean =>
  !!appUser.capabilities?.includes(action)
