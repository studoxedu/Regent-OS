import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import Login from './pages/auth/Login'
import { AppLayout } from './components/layout/AppLayout'
import { supabase } from './lib/supabase'
import { OFFICE_DEFAULT_ROUTE } from './components/layout/Sidebar'
import { isK12Office } from './lib/roles'

// K12 pages
import K12Dashboard   from './pages/k12/Dashboard'
import K12Enrollment  from './pages/k12/Enrollment'
import K12Results     from './pages/k12/Results'
import K12AuditLog    from './pages/k12/AuditLog'
import K12Fees        from './pages/k12/Fees'
import K12Promotion   from './pages/k12/Promotion'
import K12Transfers   from './pages/k12/Transfers'
import K12Calendar    from './pages/k12/Calendar'
import K12Classes     from './pages/k12/Classes'
import K12Attendance  from './pages/k12/Attendance'
import K12Timetable   from './pages/k12/Timetable'
import FeeManagement  from './pages/k12/FeeManagement'
import ReportCards    from './pages/k12/ReportCards'
import Guardians      from './pages/k12/Guardians'
import SchoolProfile  from './pages/k12/SchoolProfile'

// Tertiary pages
import TertiaryDashboard       from './pages/tertiary/Dashboard'
import TertiaryStudents        from './pages/tertiary/Students'
import TertiaryStaff           from './pages/tertiary/Staff'
import TertiaryStructure       from './pages/tertiary/Structure'
import TertiarySessions        from './pages/tertiary/Sessions'
import TertiaryResultsPipeline from './pages/tertiary/ResultsPipeline'
import TertiaryTranscripts     from './pages/tertiary/Transcripts'
import TertiaryGradeScales     from './pages/tertiary/GradeScales'
import TertiaryFees             from './pages/tertiary/Fees'
import TertiarySetup            from './pages/tertiary/Setup'
import TertiaryCoredesk         from './pages/tertiary/Coredesk'
import TertiaryAcadex           from './pages/tertiary/Acadex'
import TertiarySchedox          from './pages/tertiary/Schedox'
import TertiaryPaydesk          from './pages/tertiary/Paydesk'
import TertiarySenate           from './pages/tertiary/Senate'
import TertiaryBoards           from './pages/tertiary/Boards'
import LecturerCourseScores     from './pages/tertiary/LecturerCourseScores'
import TertiaryScoreReview      from './pages/tertiary/ScoreReview'

import CourseRegistration       from './pages/tertiary/CourseRegistration'

// Proprietor pages
import ProprietorDashboard    from './pages/proprietor/Dashboard'
import ProprietorAudit        from './pages/proprietor/Audit'
import ProprietorSchoolDetail from './pages/proprietor/SchoolDetail'

// Super admin pages
import SuperAdminDashboard from './pages/superadmin/Dashboard'
import SuperAdminSchools   from './pages/superadmin/Schools'
import SuperAdminGroups    from './pages/superadmin/Groups'

// Student portal
import StudentHome          from './pages/student/Home'
import StudentDashboard     from './pages/student/Dashboard'
import StudentCourses       from './pages/student/Courses'
import StudentMaterials     from './pages/student/Materials'
import StudentTimetable     from './pages/student/Timetable'
import StudentResults       from './pages/student/Results'
import StudentFees          from './pages/student/Fees'
import StudentTransactions  from './pages/student/Transactions'
import StudentAccommodation from './pages/student/Accommodation'
import StudentProfile       from './pages/student/Profile'

// Shared operations
import StaffManagement from './pages/shared/StaffManagement'
import Payroll         from './pages/shared/Payroll'
import Library         from './pages/shared/Library'
import Announcements   from './pages/shared/Announcements'
import Messages        from './pages/shared/Messages'
import CBT             from './pages/shared/CBT'
import StudentTests    from './pages/student/Tests'

// Parent portal
import ParentLogin     from './pages/portal/ParentLogin'
import ParentDashboard from './pages/portal/ParentDashboard'

import { SyncBanner } from './components/ui/SyncBanner'

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

  if (checking) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-sm text-gray-400">Loading…</div></div>

  if (!email) return <ParentLogin onSignIn={setEmail} />

  return <ParentDashboard guardianEmail={email} onSignOut={async () => { await supabase.auth.signOut(); setEmail(null) }} />
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
      : isK12Office(office) ? '/k12'
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
    : isK12        ? '/k12'
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
