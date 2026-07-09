// ── Domain types ──────────────────────────────────────────────

export type Stage =
  | 'nursery' | 'primary' | 'jss' | 'sss'
  | 'nd' | 'hnd' | 'nce' | 'degree'

export type GovernanceMode = 'k12' | 'tertiary'

export type OfficeType =
  | 'school_admin' | 'dean' | 'hod' | 'exam_officer' | 'lecturer' | 'student'
  | 'head_teacher' | 'class_teacher' | 'bursar'
  | 'proprietor'
  | 'super_admin'
  | 'senate_secretary' | 'registrar' | 'finance_officer' | 'hr_officer'
  | 'timetable_officer' | 'library_officer' | 'admissions_officer'
  | (string & {})

export type ResultStatus = 'draft' | 'submitted' | 'verified' | 'approved' | 'published'
export type EnrollmentStatus = 'active' | 'transferred' | 'graduated' | 'withdrawn'
export type TierType = 'pilot' | 'standard'

// ── Database row types ────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  global_role: 'super_admin' | null
  avatar_url: string | null
}

export interface School {
  id: string
  group_id: string | null
  name: string
  stages_offered: Stage[]
  tier_id: TierType
  student_cap: number | null
  modules_included: string[]
  is_active: boolean
  institution_type: 'university' | 'polytechnic' | 'college_of_education' | 'monotechnic' | null
  created_at: string
}

export interface SchoolGroup {
  id: string
  name: string
  created_at: string
}

export interface EducationLevel {
  id: string
  stage: Stage
  ordinal: number
  label: string
}

export interface Membership {
  id: string
  profile_id: string
  school_id: string | null
  group_id: string | null
  office_id: string
  department_id: string | null
  learner_id: string | null
  is_active: boolean
  created_at: string
  // joined
  office?: Office
}

export interface Office {
  id: string
  name: OfficeType
  governance_mode: 'k12' | 'tertiary' | 'group'
  description: string | null
}

export interface Learner {
  id: string
  learner_id: string  // STX-YYYY-NNNNN
  first_name: string
  last_name: string
  date_of_birth: string | null
  created_at: string
}

export interface LearnerEnrollment {
  id: string
  learner_id: string
  school_id: string
  stage: Stage
  entry_date: string
  exit_date: string | null
  status: EnrollmentStatus
  guardian_consent_captured: boolean
  guardian_consent_at: string | null
  created_at: string
  // joined
  learner?: Learner
}

export interface AuditLogEntry {
  id: string
  audit_ref: string
  school_id: string
  action_type: string
  actor_profile_id: string
  actor_office: OfficeType
  payload: Record<string, unknown>
  created_at: string
  // joined
  actor?: Profile
}

// Tertiary
export interface Faculty {
  id: string
  school_id: string
  name: string
  code: string | null
  created_at: string
}

export interface Department {
  id: string
  faculty_id: string
  name: string
  code: string | null
  created_at: string
  // joined
  faculty?: Faculty
}

export interface Course {
  id: string
  department_id: string
  code: string
  title: string
  credit_units: number
}

export interface AcademicSession {
  id: string
  school_id: string
  label: string
  is_active: boolean
  created_at: string
  semesters?: Semester[]
}

export interface Semester {
  id: string
  session_id: string
  school_id: string
  label: string
  ordinal: number
  is_active: boolean
  created_at: string
}

export interface CourseOffering {
  id: string
  course_id: string
  semester_id: string
  lecturer_membership_id: string | null
  results_status: ResultStatus
  created_at: string
  // joined
  course?: Course
  semester?: Semester & { session?: AcademicSession }
}

export interface CourseRegistration {
  id: string
  offering_id: string
  enrollment_id: string
  ca_score: number | null
  exam_score: number | null
  grade: string | null
  created_at: string
  // joined
  enrollment?: LearnerEnrollment
}

export interface GradeScale {
  id: string
  school_id: string
  min_score: number
  max_score: number
  grade: string
  grade_point: number
  description: string | null
}

// K12
export interface TermResult {
  id: string
  enrollment_id: string
  school_id: string
  academic_session: string
  term: 1 | 2 | 3
  education_level_id: string | null
  scores: Record<string, { ca: number; exam: number; total: number }> | null
  status: 'draft' | 'published'
  finalized_at: string | null
  created_at: string
  // joined
  enrollment?: LearnerEnrollment
}

export interface FeeRecord {
  id: string
  enrollment_id: string
  school_id: string
  amount: number
  description: string | null
  academic_session: string | null
  term: number | null
  receipt_ref: string
  recorded_at: string
  // joined
  enrollment?: LearnerEnrollment
}

// ── UI / App state ────────────────────────────────────────────

export interface LecturerOffering {
  id: string
  results_status: string
  course: { code: string; title: string } | null
  semester: { label: string; session: { label: string; is_active: boolean } | null } | null
}

export interface AppUser {
  profile: Profile
  memberships: Membership[]
  activeMembership: Membership | null
  activeSchool: School | null
  activeGroup: SchoolGroup | null
  proprietorSchools?: School[]
  lecturerOfferings?: LecturerOffering[]
}

export type FlowExecuteResult = {
  ok: boolean
  audit_ref: string
  action: string
  result: Record<string, unknown>
}

// ── Phase 1 types ─────────────────────────────────────────────

export interface K12AcademicSession {
  id: string
  school_id: string
  label: string
  start_date: string | null
  end_date: string | null
  is_active: boolean
  created_at: string
  terms?: K12Term[]
}

export interface K12Term {
  id: string
  session_id: string
  school_id: string
  term_number: 1 | 2 | 3
  label: string
  start_date: string | null
  end_date: string | null
  is_active: boolean
  created_at: string
}

export interface K12Class {
  id: string
  school_id: string
  name: string
  stage: Stage
  class_teacher_membership_id: string | null
  created_at: string
  class_teacher?: Membership & { profile?: Profile }
}

export interface K12Subject {
  id: string
  school_id: string
  name: string
  stage: Stage | null
  created_at: string
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface AttendanceRecord {
  id: string
  school_id: string
  enrollment_id: string
  class_id: string | null
  term_id: string | null
  date: string
  status: AttendanceStatus
  note: string | null
  recorded_by: string | null
  created_at: string
  enrollment?: LearnerEnrollment
}

export interface FeeCategory {
  id: string
  school_id: string
  name: string
  description: string | null
  created_at: string
}

export interface FeeStructure {
  id: string
  school_id: string
  category_id: string
  term_id: string | null
  stage: Stage | null
  amount: number
  due_date: string | null
  created_at: string
  category?: FeeCategory
  term?: K12Term
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'waived'

export interface FeeInvoice {
  id: string
  school_id: string
  enrollment_id: string
  fee_structure_id: string | null
  description: string
  amount_due: number
  amount_paid: number
  status: InvoiceStatus
  due_date: string | null
  created_at: string
  enrollment?: LearnerEnrollment
  fee_structure?: FeeStructure
}

export interface FeePayment {
  id: string
  invoice_id: string
  school_id: string
  amount: number
  receipt_ref: string
  payment_method: string
  recorded_by: string | null
  recorded_at: string
}

export interface Guardian {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  created_at: string
}

export interface GuardianLink {
  id: string
  guardian_id: string
  learner_id: string
  relationship: string
  is_primary: boolean
  created_at: string
  guardian?: Guardian
  learner?: Learner
}

// ── Registry types (tertiary Phase 1) ────────────────────────

export type TertStudentStatus = 'active' | 'suspended' | 'graduated' | 'withdrawn' | 'deferred'
export type TertProgramme = 'nd' | 'hnd' | 'nce' | 'degree' | 'pgd' | 'masters' | 'phd'

export interface TertStudent {
  id: string
  institution_id: string
  reg_number: string
  first_name: string
  last_name: string
  middle_name: string | null
  date_of_birth: string | null
  gender: 'male' | 'female' | 'other' | null
  phone: string | null
  personal_email: string | null
  department_id: string | null
  programme: TertProgramme
  admission_session_id: string | null
  status: TertStudentStatus
  auth_user_id: string | null
  created_at: string
  updated_at: string
  // joined
  department?: Department & { faculty?: Faculty }
  admission_session?: AcademicSession
}

export interface TertAdmission {
  id: string
  student_id: string
  institution_id: string
  session_id: string
  programme: TertProgramme
  department_id: string | null
  admitted_by_user_id: string
  notes: string | null
  created_at: string
}

export interface TertCreateResult {
  student_id: string
  reg_number: string
  temp_password: string
  login_email: string
}

// ── Phase 2 types ─────────────────────────────────────────────

export interface TimetablePeriod {
  id: string
  school_id: string
  ordinal: number
  label: string
  start_time: string | null
  end_time: string | null
  is_break: boolean
  created_at: string
}

export interface TimetableSlot {
  id: string
  school_id: string
  class_id: string
  period_id: string
  day_of_week: number
  subject_id: string | null
  teacher_membership_id: string | null
  created_at: string
  subject?: K12Subject
}

export interface Notification {
  id: string
  profile_id: string
  school_id: string | null
  title: string
  body: string | null
  type: 'info' | 'success' | 'warning' | 'alert'
  link: string | null
  is_read: boolean
  created_at: string
}

// ── Phase 4 types ─────────────────────────────────────────────

export interface Conversation {
  id: string
  school_id: string
  subject: string | null
  created_by: string
  created_at: string
  last_message_at: string
  // joined
  participants?: ConversationParticipant[]
}

export interface ConversationParticipant {
  id: string
  conversation_id: string
  profile_id: string
  last_read_at: string | null
  created_at: string
  // joined
  profile?: Profile
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_profile_id: string
  body: string
  created_at: string
  // joined
  sender?: Profile
}

export type CbtTestStatus = 'draft' | 'published' | 'closed'

export interface CbtTest {
  id: string
  school_id: string
  title: string
  instructions: string | null
  offering_id: string | null
  class_id: string | null
  subject_id: string | null
  duration_minutes: number
  status: CbtTestStatus
  starts_at: string | null
  ends_at: string | null
  show_results: boolean
  created_by: string
  created_at: string
}

export interface CbtQuestion {
  id: string
  test_id: string
  ordinal: number
  prompt: string
  options: string[]
  correct_index: number
  marks: number
  created_at: string
}

export interface CbtAttempt {
  id: string
  test_id: string
  profile_id: string
  student_id: string | null
  started_at: string
  submitted_at: string | null
  answers: Record<string, number> | null
  score: number | null
  total: number | null
}

export interface GuardianNotification {
  id: string
  guardian_id: string
  school_id: string | null
  learner_id: string | null
  title: string
  body: string | null
  type: 'info' | 'success' | 'warning' | 'alert'
  is_read: boolean
  created_at: string
}

export type PaymentTxStatus = 'initialized' | 'success' | 'failed' | 'abandoned'

export interface PaymentTransaction {
  id: string
  school_id: string | null
  invoice_id: string | null
  student_id: string | null
  profile_id: string | null
  provider: string
  reference: string
  amount: number
  currency: string
  status: PaymentTxStatus
  authorization_url: string | null
  paid_at: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
