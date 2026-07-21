import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import Login from './pages/auth/Login'
import { AppLayout } from './components/layout/AppLayout'
import { supabase } from './lib/supabase'
import { OFFICE_DEFAULT_ROUTE } from './components/layout/Sidebar'
import { isK12Office, k12DefaultRoute } from './lib/roles'
import { SyncBanner } from './components/ui/SyncBanner'

// ── Route pages are lazy-loaded so each becomes its own chunk;
//    the initial bundle only carries the shell + the active route. ──

// K12 pages
const K12Dashboard   = lazy(() => import('./pages/k12/Dashboard'))
const K12Enrollment  = lazy(() => import('./pages/k12/Enrollment'))
const K12Results     = lazy(() => import('./pages/k12/Results'))
const K12AuditLog    = lazy(() => import('./pages/k12/AuditLog'))
const K12Fees        = lazy(() => import('./pages/k12/Fees'))
const K12Promotion   = lazy(() => import('./pages/k12/Promotion'))
const K12Transfers   = lazy(() => import('./pages/k12/Transfers'))
const K12Calendar    = lazy(() => import('./pages/k12/Calendar'))
const K12Classes     = lazy(() => import('./pages/k12/Classes'))
const K12Attendance  = lazy(() => import('./pages/k12/Attendance'))
const K12Timetable   = lazy(() => import('./pages/k12/Timetable'))
const FeeManagement  = lazy(() => import('./pages/k12/FeeManagement'))
const ReportCards    = lazy(() => import('./pages/k12/ReportCards'))
const Guardians      = lazy(() => import('./pages/k12/Guardians'))
const SchoolProfile  = lazy(() => import('./pages/k12/SchoolProfile'))

// Tertiary pages
const TertiaryDashboard       = lazy(() => import('./pages/tertiary/Dashboard'))
const TertiaryStudents        = lazy(() => import('./pages/tertiary/Students'))
const TertiaryStaff           = lazy(() => import('./pages/tertiary/Staff'))
const TertiaryStructure       = lazy(() => import('./pages/tertiary/Structure'))
const TertiarySessions        = lazy(() => import('./pages/tertiary/Sessions'))
const TertiaryResultsPipeline = lazy(() => import('./pages/tertiary/ResultsPipeline'))
const TertiaryTranscripts     = lazy(() => import('./pages/tertiary/Transcripts'))
const TertiaryGradeScales     = lazy(() => import('./pages/tertiary/GradeScales'))
const TertiaryFees            = lazy(() => import('./pages/tertiary/Fees'))
const TertiarySetup           = lazy(() => import('./pages/tertiary/Setup'))
const TertiaryCoredesk        = lazy(() => import('./pages/tertiary/Coredesk'))
const TertiaryAcadex          = lazy(() => import('./pages/tertiary/Acadex'))
const TertiarySchedox         = lazy(() => import('./pages/tertiary/Schedox'))
const TertiaryPaydesk         = lazy(() => import('./pages/tertiary/Paydesk'))
const TertiarySenate          = lazy(() => import('./pages/tertiary/Senate'))
const TertiaryBoards          = lazy(() => import('./pages/tertiary/Boards'))
const LecturerCourseScores    = lazy(() => import('./pages/tertiary/LecturerCourseScores'))
const TertiaryScoreReview     = lazy(() => import('./pages/tertiary/ScoreReview'))
const CourseRegistration      = lazy(() => import('./pages/tertiary/CourseRegistration'))

// Proprietor pages
const ProprietorDashboard    = lazy(() => import('./pages/proprietor/Dashboard'))
const ProprietorAudit        = lazy(() => import('./pages/proprietor/Audit'))
const ProprietorSchoolDetail = lazy(() => import('./pages/proprietor/SchoolDetail'))

// Super admin pages
const SuperAdminDashboard = lazy(() => import('./pages/superadmin/Dashboard'))
const SuperAdminSchools   = lazy(() => import('./pages/superadmin/Schools'))
const SuperAdminGroups    = lazy(() => import('./pages/superadmin/Groups'))

// Student portal
const StudentHome          = lazy(() => import('./pages/student/Home'))
const StudentDashboard     = lazy(() => import('./pages/student/Dashboard'))
const StudentCourses       = lazy(() => import('./pages/student/Courses'))
const StudentMaterials     = lazy(() => import('./pages/student/Materials'))
const StudentTimetable     = lazy(() => import('./pages/student/Timetable'))
const StudentResults       = lazy(() => import('./pages/student/Results'))
const StudentFees          = lazy(() => import('./pages/student/Fees'))
const StudentTransactions  = lazy(() => import('./pages/student/Transactions'))
const StudentAccommodation = lazy(() => import('./pages/student/Accommodation'))
const StudentProfile       = lazy(() => import('./pages/student/Profile'))
const StudentTests         = lazy(() => import('./pages/student/Tests'))

// Shared operations
const StaffManagement = lazy(() => import('./pages/shared/StaffManagement'))
const Payroll         = lazy(() => import('./pages/shared/Payroll'))
const Library         = lazy(() => import('./pages/shared/Library'))
const Announcements   = lazy(() => import('./pages/shared/Announcements'))
const Messages        = lazy(() => import('./pages/shared/Messages'))
const CBT             = lazy(() => import('./pages/shared/CBT'))

// Parent portal
const ParentLogin     = lazy(() => import('./pages/portal/ParentLogin'))
const ParentDashboard = lazy(() => import('./pages/portal/ParentDashboard'))

// ── Parent portal entry point ────────────────────────────────
function ParentPortal() {
  const [email, setEmail] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email ?? null)
      setChecking(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loader = <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-sm text-gray-400">Loading…</div></div>
  if (checking) return loader

  return (
    <Suspense fallback={loader}>
      {!email
        ? <ParentLogin onSignIn={setEmail} />
        : <ParentDashboard guardianEmail={email} onSignOut={async () => { await supabase.auth.signOut(); setEmail(null) }} />}
    </Suspense>
  )
}

// ── Main app ─────────────────────────────────────────────────
function ProtectedApp() {
  const { appUser, loading, signIn, signOut, switchMembership } = useAuth()
  const navigate = useNavigate()

  function handleSwitch(membershipId: string) {
    switchMembership(membershipId)
    const target = appUser?.memberships.find(m => m.id === membershipId)
    const office = target?.office?.name ?? ''
    const route  = office === 'proprietor' ? '/proprietor'
      : isK12Office(office) ? k12DefaultRoute(office)
      : office === 'student' ? '/student'
      : '/tertiary'
    navigate(route, { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="text-navy-400 text-xs tracking-widest uppercase">Loading…</div>
      </div>
    )
  }

  if (!appUser) return <Login onSignIn={signIn} />

  // Guardians/parents have no staff membership — they belong in the parent
  // portal (only their linked child's record), never the staff app + sidebar.
  if (appUser.memberships.length === 0) return <Navigate to="/portal" replace />

  const officeName   = appUser.activeMembership?.office?.name ?? ''
  const isSuperAdmin = officeName === 'super_admin'
  const isProprietor = officeName === 'proprietor'
  const isK12        = isK12Office(officeName)
  const isStudent    = officeName === 'student'
  const isLecturer   = officeName === 'lecturer'
  // Lecturers land on their first assigned course; fall back to acadex if none
  const lecturerHome = appUser.lecturerOfferings?.[0]
    ? `/tertiary/course-scores/${appUser.lecturerOfferings[0].id}`
    : '/tertiary/acadex'
  const tertiaryHome = isLecturer ? lecturerHome : (OFFICE_DEFAULT_ROUTE[officeName] ?? '/tertiary')
  const defaultRoute = isSuperAdmin ? '/superadmin'
    : isProprietor ? '/proprietor'
    : isK12        ? k12DefaultRoute(officeName)
    : isStudent    ? '/student'
    : tertiaryHome

  return (
    <Routes>
      <Route element={<AppLayout appUser={appUser} onSignOut={signOut} onSwitchMembership={handleSwitch} />}>

        {/* ── K12 ── */}
        <Route path="/k12"                 element={<K12Dashboard   appUser={appUser} />} />
        <Route path="/k12/enrollment"      element={<K12Enrollment  appUser={appUser} />} />
        <Route path="/k12/results"         element={<K12Results     appUser={appUser} />} />
        <Route path="/k12/audit"           element={<K12AuditLog    appUser={appUser} />} />
        <Route path="/k12/transfers"       element={<K12Transfers   appUser={appUser} />} />
        <Route path="/k12/promotion"       element={<K12Promotion   appUser={appUser} />} />
        <Route path="/k12/calendar"        element={<K12Calendar    appUser={appUser} />} />
        <Route path="/k12/classes"         element={<K12Classes     appUser={appUser} />} />
        <Route path="/k12/attendance"      element={<K12Attendance  appUser={appUser} />} />
        <Route path="/k12/fee-management"  element={<FeeManagement  appUser={appUser} />} />
        <Route path="/k12/report-cards"    element={<ReportCards    appUser={appUser} />} />
        <Route path="/k12/guardians"       element={<Guardians      appUser={appUser} />} />
        <Route path="/k12/fees"            element={<K12Fees          appUser={appUser} />} />
        <Route path="/k12/timetable"       element={<K12Timetable     appUser={appUser} />} />
        <Route path="/k12/staff"           element={<StaffManagement  appUser={appUser} />} />
        <Route path="/k12/payroll"         element={<Payroll          appUser={appUser} />} />
        <Route path="/k12/library"         element={<Library          appUser={appUser} />} />
        <Route path="/k12/announcements"   element={<Announcements    appUser={appUser} />} />
        <Route path="/k12/messages"        element={<Messages         appUser={appUser} />} />
        <Route path="/k12/cbt"             element={<CBT              appUser={appUser} />} />
        <Route path="/k12/school"          element={<SchoolProfile    appUser={appUser} />} />

        {/* ── Tertiary ── */}
        <Route path="/tertiary"               element={<TertiaryDashboard       appUser={appUser} />} />
        <Route path="/tertiary/audit"         element={<K12AuditLog             appUser={appUser} />} />
        <Route path="/tertiary/results"       element={<TertiaryResultsPipeline appUser={appUser} />} />
        <Route path="/tertiary/students"      element={<TertiaryStudents        appUser={appUser} />} />
        <Route path="/tertiary/staff"         element={<TertiaryStaff           appUser={appUser} />} />
        <Route path="/tertiary/structure"     element={<TertiaryStructure       appUser={appUser} />} />
        <Route path="/tertiary/sessions"      element={<TertiarySessions        appUser={appUser} />} />
        <Route path="/tertiary/transcripts"   element={<TertiaryTranscripts     appUser={appUser} />} />
        <Route path="/tertiary/grade-scales"  element={<TertiaryGradeScales     appUser={appUser} />} />
        <Route path="/tertiary/coredesk"          element={<TertiaryCoredesk         appUser={appUser} />} />
        <Route path="/tertiary/acadex"            element={<TertiaryAcadex           appUser={appUser} />} />
        <Route path="/tertiary/setup"             element={<TertiarySetup            appUser={appUser} />} />
        <Route path="/tertiary/senate"            element={<TertiarySenate       appUser={appUser} />} />
        <Route path="/tertiary/boards"            element={<TertiaryBoards       appUser={appUser} />} />
        <Route path="/tertiary/course-scores/:offeringId" element={<LecturerCourseScores appUser={appUser} />} />
        <Route path="/tertiary/score-review"              element={<TertiaryScoreReview  appUser={appUser} />} />
        <Route path="/tertiary/schedox"           element={<TertiarySchedox      appUser={appUser} />} />
        <Route path="/tertiary/paydesk"           element={<TertiaryPaydesk      appUser={appUser} />} />
        <Route path="/tertiary/timetable"         element={<TertiarySchedox      appUser={appUser} />} />
        <Route path="/tertiary/fees"              element={<TertiaryFees         appUser={appUser} />} />
        <Route path="/tertiary/announcements"     element={<Announcements        appUser={appUser} />} />
        <Route path="/tertiary/course-reg"        element={<CourseRegistration   appUser={appUser} />} />
        <Route path="/tertiary/staff-mgmt"        element={<StaffManagement      appUser={appUser} />} />
        <Route path="/tertiary/payroll"           element={<Payroll              appUser={appUser} />} />
        <Route path="/tertiary/library"           element={<Library              appUser={appUser} />} />
        <Route path="/tertiary/messages"          element={<Messages             appUser={appUser} />} />
        <Route path="/tertiary/cbt"               element={<CBT                  appUser={appUser} />} />

        {/* ── Student portal ── */}
        <Route path="/student"               element={<StudentHome          appUser={appUser} />} />
        <Route path="/student/dashboard"     element={<StudentDashboard     appUser={appUser} />} />
        <Route path="/student/courses"       element={<StudentCourses       appUser={appUser} />} />
        <Route path="/student/timetable"     element={<StudentTimetable     appUser={appUser} />} />
        <Route path="/student/materials"     element={<StudentMaterials     appUser={appUser} />} />
        <Route path="/student/results"       element={<StudentResults       appUser={appUser} />} />
        <Route path="/student/announcements" element={<Announcements        appUser={appUser} />} />
        <Route path="/student/fees"          element={<StudentFees          appUser={appUser} />} />
        <Route path="/student/transactions"  element={<StudentTransactions  appUser={appUser} />} />
        <Route path="/student/accommodation" element={<StudentAccommodation appUser={appUser} />} />
        <Route path="/student/library"       element={<Library              appUser={appUser} />} />
        <Route path="/student/profile"       element={<StudentProfile       appUser={appUser} />} />
        <Route path="/student/messages"      element={<Messages             appUser={appUser} />} />
        <Route path="/student/tests"         element={<StudentTests         appUser={appUser} />} />

        {/* ── Proprietor ── */}
        <Route path="/proprietor"            element={<ProprietorDashboard    appUser={appUser} />} />
        <Route path="/proprietor/audit"      element={<ProprietorAudit        appUser={appUser} />} />
        <Route path="/proprietor/school/:id" element={<ProprietorSchoolDetail appUser={appUser} />} />

        {/* ── Super Admin ── */}
        <Route path="/superadmin"         element={<SuperAdminDashboard appUser={appUser} />} />
        <Route path="/superadmin/schools" element={<SuperAdminSchools   appUser={appUser} />} />
        <Route path="/superadmin/groups"  element={<SuperAdminGroups    appUser={appUser} />} />

        <Route path="/"  element={<Navigate to={defaultRoute} replace />} />
        <Route path="*"  element={<Navigate to={defaultRoute} replace />} />
      </Route>
    </Routes>
  )
}

// Electron loads via file:// where the HTML5 history API can't work, so fall
// back to hash-based routing there; the web build keeps clean BrowserRouter URLs.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Parent portal lives at /portal — separate from staff app */}
        <Route path="/portal/*" element={<ParentPortal />} />
        {/* Everything else is the staff app */}
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
      <SyncBanner />
    </Router>
  )
}
