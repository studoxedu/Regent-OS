import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { getInstitutionLabels } from '../../lib/institution'
import { isK12Office, K12_OFFICE_SECTIONS } from '../../lib/roles'
import type { AppUser, LecturerOffering } from '../../types'
import type { ReactNode } from 'react'

interface NavItem {
  label: string
  to: string
}

interface NavSection {
  key: string
  heading: string
  defaultTo: string          // where the heading link goes
  items: NavItem[]           // sub-pages; shown only when section is active
  alwaysExpanded?: boolean   // bypass accordion — items always visible
}

// ── Office → allowed section keys ────────────────────────────────────────────
const OFFICE_SECTIONS: Record<string, string[]> = {
  school_admin:       ['overview','coredesk','registry','acadex','senate','schedox','paydesk','operations','hr'],
  registrar:          ['registry','acadex','boards','operations'],
  senate_secretary:   ['senate','acadex'],
  finance_officer:    ['paydesk','boards','operations'],
  bursar:             ['paydesk','boards','operations'],
  hod:                  ['acadex','boards'],
  dean:                 ['acadex','boards'],
  exam_officer:         ['acadex','boards'],
  dept_exam_officer:    ['acadex','boards'],
  faculty_exam_officer: ['acadex','boards'],
  lecturer:             ['acadex','boards'],
  timetable_officer:  ['schedox','boards'],
  hr_officer:         ['hr','boards'],
  library_officer:    ['boards','operations'],
  admissions_officer: ['registry','boards'],
}

// ── Default landing route per office type ────────────────────────────────────
export const OFFICE_DEFAULT_ROUTE: Record<string, string> = {
  school_admin:       '/tertiary',
  registrar:          '/tertiary/students',
  senate_secretary:   '/tertiary/senate',
  finance_officer:    '/tertiary/paydesk',
  bursar:             '/tertiary/paydesk',
  hod:                  '/tertiary/acadex',
  dean:                 '/tertiary/acadex',
  exam_officer:         '/tertiary/acadex',
  dept_exam_officer:    '/tertiary/acadex',
  faculty_exam_officer: '/tertiary/acadex',
  lecturer:             '/tertiary/acadex',
  timetable_officer:  '/tertiary/schedox',
  hr_officer:         '/tertiary/staff-mgmt',
  library_officer:    '/tertiary/library',
  admissions_officer: '/tertiary/students',
}

// ── Lecturer module list (courses as nav items, always expanded) ──────────────
function lecturerModules(offerings: LecturerOffering[] | undefined): NavSection[] {
  const statusDot = (s: string) => s === 'submitted' ? ' ·' : s === 'verified' ? ' ·' : s === 'published' ? ' ·' : ''
  const items = (offerings ?? []).map(o => ({
    label: `${o.course?.code ?? '?'}${statusDot(o.results_status)} — ${o.course?.title ?? 'Course'}`,
    to: `/tertiary/course-scores/${o.id}`,
  }))

  return [
    {
      key: 'my-courses',
      heading: 'My Courses',
      defaultTo: items[0]?.to ?? '/tertiary/acadex',
      alwaysExpanded: true,
      items: items.length > 0 ? items : [{ label: 'No courses assigned', to: '/tertiary/acadex' }],
    },
    {
      key: 'cbt',
      heading: 'CBT',
      defaultTo: '/tertiary/cbt',
      items: [{ label: 'Tests & Quizzes', to: '/tertiary/cbt' }],
    },
    {
      key: 'messages',
      heading: 'Messages',
      defaultTo: '/tertiary/messages',
      items: [{ label: 'Inbox', to: '/tertiary/messages' }],
    },
    {
      key: 'boards',
      heading: 'Boards',
      defaultTo: '/tertiary/boards',
      items: [{ label: 'Committees & Groups', to: '/tertiary/boards' }],
    },
  ]
}

// Roles where /tertiary/boards lives inside the senate section (not standalone)
const SENATE_BOARDS_ROLES = new Set(['school_admin', 'senate_secretary'])

// ── Route → section key ───────────────────────────────────────────────────────
function getActiveSectionKey(pathname: string, officeName?: string): string {
  if (pathname.startsWith('/tertiary/course-scores')) return 'my-courses'
  if (pathname.startsWith('/tertiary/cbt'))      return officeName === 'lecturer' ? 'cbt' : 'acadex'
  if (pathname.startsWith('/tertiary/messages')) return officeName === 'lecturer' ? 'messages' : 'operations'
  if (['/tertiary/setup','/tertiary/students','/tertiary/structure','/tertiary/staff','/tertiary/sessions'].some(p => pathname.startsWith(p))) return 'registry'
  if (['/tertiary/acadex','/tertiary/transcripts','/tertiary/grade-scales','/tertiary/course-reg','/tertiary/score-review'].some(p => pathname.startsWith(p))) return 'acadex'
  if (pathname.startsWith('/tertiary/senate'))   return 'senate'
  if (pathname.startsWith('/tertiary/coredesk')) return 'coredesk'
  if (['/tertiary/schedox','/tertiary/timetable'].some(p => pathname.startsWith(p))) return 'schedox'
  if (pathname.startsWith('/tertiary/paydesk'))  return 'paydesk'
  if (pathname.startsWith('/tertiary/boards'))   return SENATE_BOARDS_ROLES.has(officeName ?? '') ? 'senate' : 'boards'
  if (['/tertiary/fees','/tertiary/announcements','/tertiary/library'].some(p => pathname.startsWith(p))) return 'operations'
  if (['/tertiary/staff-mgmt','/tertiary/payroll'].some(p => pathname.startsWith(p))) return 'hr'
  return 'overview'
}

// ── Tertiary section definitions ──────────────────────────────────────────────
function tertiaryModules(institutionType?: string | null, officeName?: string): NavSection[] {
  const labels  = getInstitutionLabels(institutionType)
  const allowed = OFFICE_SECTIONS[officeName ?? ''] ?? null   // null = show all

  const all: NavSection[] = [
    { key:'overview',  heading:'Overview',      defaultTo:'/tertiary',
      items:[{ label:'Dashboard', to:'/tertiary' },{ label:'Audit Log', to:'/tertiary/audit' }] },
    { key:'coredesk',  heading:'Coredesk',      defaultTo:'/tertiary/coredesk',
      items:[{ label:'Offices & Staff', to:'/tertiary/coredesk' }] },
    { key:'registry',  heading:'Registry',      defaultTo:'/tertiary/students',
      items:[
        { label:'Setup',      to:'/tertiary/setup'      },
        { label:'Students',   to:'/tertiary/students'   },
        { label:'Structure',  to:'/tertiary/structure'  },
        { label:'Staff',      to:'/tertiary/staff'      },
        { label:'Sessions',   to:'/tertiary/sessions'   },
      ]},
    { key:'acadex',    heading:'Acadex',         defaultTo:'/tertiary/acadex',
      items:[
        { label:'Offerings & Results', to:'/tertiary/acadex'       },
        { label:'Transcripts',         to:'/tertiary/transcripts'  },
        { label:'Grade Scales',        to:'/tertiary/grade-scales' },
        { label:'CBT Tests',           to:'/tertiary/cbt'          },
      ]},
    { key:'senate',    heading:labels.senate,    defaultTo:'/tertiary/senate',
      items:[
        { label:'Ratification',      to:'/tertiary/senate' },
        ...( SENATE_BOARDS_ROLES.has(officeName ?? '')
          ? [{ label:'Boards & Committees', to:'/tertiary/boards' }]
          : [] ),
      ]},
    { key:'schedox',   heading:'Schedox',        defaultTo:'/tertiary/schedox',
      items:[{ label:'Timetable & Venues', to:'/tertiary/schedox' }] },
    { key:'paydesk',   heading:'Paydesk',        defaultTo:'/tertiary/paydesk',
      items:[{ label:'Invoices & Payments', to:'/tertiary/paydesk' }] },
    { key:'boards',    heading:'Boards',         defaultTo:'/tertiary/boards',
      items:[{ label:'Committees & Groups', to:'/tertiary/boards' }] },
    { key:'operations',heading:'Operations',     defaultTo:'/tertiary/announcements',
      items:[
        { label:'Fees',          to:'/tertiary/fees'          },
        { label:'Announcements', to:'/tertiary/announcements' },
        { label:'Messages',      to:'/tertiary/messages'      },
        { label:'Library',       to:'/tertiary/library'       },
      ]},
    { key:'hr',        heading:'HR',             defaultTo:'/tertiary/staff-mgmt',
      items:[
        { label:'Staff Profiles', to:'/tertiary/staff-mgmt' },
        { label:'Payroll',        to:'/tertiary/payroll'     },
      ]},
  ]

  return allowed ? all.filter(s => allowed.includes(s.key)) : all
}

// ── K12 — sections filtered by office (see K12_OFFICE_SECTIONS) ───────────────
function k12Modules(officeName?: string): NavSection[] {
  const all: NavSection[] = [
    { key:'overview',  heading:'Overview',   defaultTo:'/k12',
      items:[{ label:'Dashboard', to:'/k12' },{ label:'Audit Log', to:'/k12/audit' }] },
    { key:'setup',     heading:'Setup',      defaultTo:'/k12/school',
      items:[
        { label:'School Profile',   to:'/k12/school'   },
        { label:'Academic Calendar', to:'/k12/calendar' },
        { label:'Classes & Subjects', to:'/k12/classes' },
      ]},
    { key:'admissions', heading:'Admissions & Records', defaultTo:'/k12/enrollment',
      items:[
        { label:'Enrollment',  to:'/k12/enrollment'   },
        { label:'Guardians',   to:'/k12/guardians'    },
        { label:'Transfers',   to:'/k12/transfers'    },
        { label:'Promotion',   to:'/k12/promotion'    },
      ]},
    { key:'academics', heading:'Academics',  defaultTo:'/k12/results',
      items:[
        { label:'Attendance',   to:'/k12/attendance'   },
        { label:'Results',      to:'/k12/results'      },
        { label:'Report Cards', to:'/k12/report-cards' },
        { label:'Timetable',    to:'/k12/timetable'    },
        { label:'CBT Tests',    to:'/k12/cbt'          },
      ]},
    { key:'finance',   heading:'Finance',    defaultTo:'/k12/fee-management',
      items:[{ label:'Fee Management', to:'/k12/fee-management' }] },
    { key:'hr',        heading:'HR',         defaultTo:'/k12/staff',
      items:[{ label:'Staff Management', to:'/k12/staff' },{ label:'Payroll', to:'/k12/payroll' }] },
    { key:'resources', heading:'Resources',  defaultTo:'/k12/library',
      items:[
        { label:'Library',       to:'/k12/library'       },
        { label:'Announcements', to:'/k12/announcements' },
        { label:'Messages',      to:'/k12/messages'      },
      ]},
  ]

  const allowed = K12_OFFICE_SECTIONS[officeName ?? '']   // null / undefined = show all
  return allowed ? all.filter(s => allowed.includes(s.key)) : all
}

function getK12ActiveKey(pathname: string): string {
  if (['/k12/school','/k12/calendar','/k12/classes'].some(p => pathname.startsWith(p))) return 'setup'
  if (['/k12/enrollment','/k12/guardians','/k12/transfers','/k12/promotion'].some(p => pathname.startsWith(p))) return 'admissions'
  if (['/k12/attendance','/k12/results','/k12/report-cards','/k12/timetable','/k12/cbt'].some(p => pathname.startsWith(p))) return 'academics'
  if (pathname.startsWith('/k12/fee-management') || pathname.startsWith('/k12/fees')) return 'finance'
  if (['/k12/staff','/k12/payroll'].some(p => pathname.startsWith(p))) return 'hr'
  if (['/k12/library','/k12/announcements','/k12/messages'].some(p => pathname.startsWith(p))) return 'resources'
  return 'overview'
}

// ── Student (flat — few items) ────────────────────────────────────────────────
function studentModules(): NavSection[] {
  return [
    { key:'main',     heading:'Main',     defaultTo:'/student',
      items:[{ label:'Home', to:'/student' },{ label:'Dashboard', to:'/student/dashboard' }] },
    { key:'academic', heading:'Academic', defaultTo:'/student/courses',
      items:[
        { label:'Courses',       to:'/student/courses'       },
        { label:'Timetable',     to:'/student/timetable'     },
        { label:'Materials',     to:'/student/materials'     },
        { label:'Tests & CBT',   to:'/student/tests'         },
        { label:'Results',       to:'/student/results'       },
        { label:'Announcements', to:'/student/announcements' },
        { label:'Messages',      to:'/student/messages'      },
      ]},
    { key:'finance',  heading:'Finance',  defaultTo:'/student/fees',
      items:[{ label:'Fees', to:'/student/fees' },{ label:'Transactions', to:'/student/transactions' }] },
    { key:'campus',   heading:'Campus',   defaultTo:'/student/accommodation',
      items:[
        { label:'Accommodation', to:'/student/accommodation' },
        { label:'Library',       to:'/student/library'       },
      ]},
    { key:'account',  heading:'Account',  defaultTo:'/student/profile',
      items:[{ label:'Profile', to:'/student/profile' }] },
  ]
}

function getStudentActiveKey(pathname: string): string {
  if (['/student/courses','/student/timetable','/student/materials','/student/tests','/student/results','/student/announcements','/student/messages'].some(p => pathname.startsWith(p))) return 'academic'
  if (['/student/fees','/student/transactions'].some(p => pathname.startsWith(p))) return 'finance'
  if (['/student/accommodation','/student/library'].some(p => pathname.startsWith(p))) return 'campus'
  if (pathname.startsWith('/student/profile')) return 'account'
  return 'main'
}

// ── Proprietor + Super admin (flat — few items, no accordion needed) ──────────
function proprietorModules(schools: { name: string; id: string }[]): NavSection[] {
  const sections: NavSection[] = [
    { key:'group', heading:'Group View', defaultTo:'/proprietor',
      items:[{ label:'Dashboard', to:'/proprietor' },{ label:'Audit Activity', to:'/proprietor/audit' }] },
  ]
  if (schools.length > 0) {
    sections.push({ key:'schools', heading:'Institutions', defaultTo:schools[0] ? `/proprietor/school/${schools[0].id}` : '/proprietor',
      items: schools.map(s => ({ label: s.name, to: `/proprietor/school/${s.id}` })) })
  }
  return sections
}

function superAdminModules(): NavSection[] {
  return [
    { key:'platform',     heading:'Platform',     defaultTo:'/superadmin',
      items:[{ label:'Overview', to:'/superadmin' }] },
    { key:'institutions', heading:'Institutions', defaultTo:'/superadmin/schools',
      items:[{ label:'Schools', to:'/superadmin/schools' },{ label:'Groups', to:'/superadmin/groups' }] },
  ]
}

// ── Sidebar component ─────────────────────────────────────────────────────────

interface SidebarProps {
  appUser: AppUser
  onSignOut: () => void
  onSwitchMembership: (id: string) => void
  children?: ReactNode
}

export function Sidebar({ appUser, onSignOut, onSwitchMembership: _onSwitch, children }: SidebarProps) {
  const location = useLocation()
  const { activeMembership, activeSchool, activeGroup } = appUser
  const officeName   = activeMembership?.office?.name ?? ''
  const isSuperAdmin = officeName === 'super_admin'
  const isProprietor = officeName === 'proprietor'
  const isK12        = isK12Office(officeName)
  const isStudent    = officeName === 'student'

  // ── Active section key (drives accordion) ──
  const activeSectionKey = isSuperAdmin || isProprietor
    ? null   // these don't use accordion — they're always flat (few items)
    : isK12
    ? getK12ActiveKey(location.pathname)
    : isStudent
    ? getStudentActiveKey(location.pathname)
    : getActiveSectionKey(location.pathname, officeName)

  const isLecturer = officeName === 'lecturer'

  // ── Which module list to render ──
  const modules: NavSection[] = isSuperAdmin
    ? superAdminModules()
    : isProprietor
    ? proprietorModules(appUser.proprietorSchools ?? [])
    : isK12
    ? k12Modules(officeName)
    : isStudent
    ? studentModules()
    : isLecturer
    ? lecturerModules(appUser.lecturerOfferings)
    : tertiaryModules(activeSchool?.institution_type, officeName)

  // ── Brand ──
  const name     = [appUser.profile.first_name, appUser.profile.last_name].filter(Boolean).join(' ') || appUser.profile.email
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  const brandName = isSuperAdmin
    ? 'Regent OS'
    : activeSchool?.name ?? activeGroup?.name ?? 'Regent OS'
  const brandSub = isSuperAdmin
    ? 'Platform Admin'
    : isProprietor
    ? `Proprietor · ${activeGroup?.name ?? ''}`
    : activeSchool?.stages_offered?.map(s => s.toUpperCase()).join(' · ') ?? ''

  // ── Role label shown in footer ──
  const roleLabel = officeName.replace(/_/g, ' ')

  return (
    <aside className="w-[220px] bg-navy-900 flex flex-col flex-shrink-0 h-full">

      {/* Brand */}
      <div className="px-4 py-[18px] border-b border-navy-800">
        <div className="text-[13px] font-bold text-white truncate">{brandName}</div>
        {brandSub && (
          <div className="text-[10px] text-navy-400 mt-0.5 tracking-[0.04em] uppercase truncate">
            {brandSub}
          </div>
        )}
      </div>

      {/* Nav — accordion */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
        {modules.map(section => {
          const isActive   = activeSectionKey === section.key
          const singleItem = section.items.length === 1

          return (
            <div key={section.key}>
              {/*
                Section heading:
                - Always a NavLink pointing to defaultTo
                - Highlighted when this section is active
                - If single-item section, heading IS the only nav item
              */}
              <NavLink
                to={section.defaultTo}
                end={section.defaultTo.split('/').length <= 2}
                className={({ isActive: linkActive }) => cn(
                  'flex items-center gap-2.5 px-4 py-[7px] text-[12px] font-medium tracking-wide',
                  'transition-colors border-l-[3px] cursor-pointer',
                  (linkActive || isActive)
                    ? 'bg-navy-800/70 text-white border-l-amber-500'
                    : 'text-navy-400 border-l-transparent hover:text-navy-200 hover:bg-navy-800/40'
                )}
              >
                <span className={cn(
                  'w-[5px] h-[5px] rounded-sm flex-shrink-0 transition-colors',
                  (isActive) ? 'bg-amber-500' : 'bg-navy-600'
                )} />
                {section.heading}
              </NavLink>

              {/*
                Sub-items: shown when section is active OR alwaysExpanded.
                Single-item sections navigate directly via the heading link.
              */}
              {(isActive || section.alwaysExpanded) && (!singleItem || section.alwaysExpanded) && (
                <div className="mt-0.5 mb-1">
                  {section.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to.split('/').length <= 2}
                      className={({ isActive: linkActive }) => cn(
                        'flex items-center gap-2 pl-8 pr-4 py-[6px] text-[12px]',
                        'border-l-[3px] transition-colors cursor-pointer',
                        linkActive
                          ? 'bg-navy-800 text-white border-l-amber-400'
                          : 'text-navy-300 border-l-transparent hover:bg-navy-800/60 hover:text-white'
                      )}
                    >
                      <span className="w-[3px] h-[3px] rounded-full bg-current opacity-50 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-4 py-3 border-t border-navy-800 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-navy-700 flex items-center justify-center text-[11px] font-bold text-navy-200 flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white truncate">{name}</div>
          <div className="text-[10px] text-navy-400 uppercase tracking-[0.04em] truncate">{roleLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          {children}
          <button
            onClick={onSignOut}
            className="text-navy-400 hover:text-white text-xs cursor-pointer bg-transparent border-none w-8 h-8 flex items-center justify-center"
            title="Sign out"
          >
            ⎋
          </button>
        </div>
      </div>
    </aside>
  )
}
