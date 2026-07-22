import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppUser, Profile, Membership, School, SchoolGroup, LecturerOffering } from '../types'

export function useAuth() {
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeMembershipId, setActiveMembershipId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadUser(preferMembershipId?: string | null) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        if (mounted) { setAppUser(null); setLoading(false) }
        return
      }

      let { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!profile) {
        const { data: created } = await supabase
          .from('profiles')
          .insert({ id: session.user.id, email: session.user.email ?? '' })
          .select()
          .single()
        profile = created
        if (!profile) {
          if (mounted) { setAppUser(null); setLoading(false) }
          return
        }
      }

      // Platform super admin — bypass normal membership routing
      if ((profile as Profile)?.global_role === 'super_admin') {
        const synthSuper: Membership = {
          id: 'super-admin',
          profile_id: session.user.id,
          school_id: null,
          group_id: null,
          office_id: 'super-admin',
          department_id: null,
          learner_id: null,
          is_active: true,
          created_at: new Date().toISOString(),
          office: { id: 'super-admin', name: 'super_admin', governance_mode: 'group', description: null },
        }
        if (mounted) {
          setAppUser({
            profile: profile as Profile,
            memberships: [synthSuper],
            activeMembership: synthSuper,
            activeSchool: null,
            activeGroup: null,
          })
          setLoading(false)
        }
        return
      }

      const { data: memberships } = await supabase
        .from('memberships')
        .select('*, office:offices(*)')
        .eq('profile_id', session.user.id)
        .eq('is_active', true)

      const all = (memberships ?? []) as Membership[]

      // Tertiary student — no membership row, identified via students table
      if (all.length === 0) {
        const { data: sCtx } = await supabase.rpc('get_student_context')
        if (sCtx) {
          const sc = sCtx as { student_id: string; school_id: string; department_id: string | null }
          const { data: school } = await supabase
            .from('schools').select('*').eq('id', sc.school_id).single()
          const synth: Membership = {
            id: `tert-${sc.student_id}`,
            profile_id: session.user.id,
            school_id: sc.school_id,
            group_id: null,
            office_id: 'tert-student',
            department_id: sc.department_id,
            learner_id: null,
            is_active: true,
            created_at: new Date().toISOString(),
            office: { id: 'tert-student', name: 'student', governance_mode: 'tertiary', description: null },
          }
          if (mounted) {
            setAppUser({
              profile: profile as Profile,
              memberships: [synth],
              activeMembership: synth,
              activeSchool: school as School,
              activeGroup: null,
            })
            setLoading(false)
          }
          return
        }
      }

      const activeMembership = (preferMembershipId
        ? all.find(m => m.id === preferMembershipId)
        : null) ?? all[0] ?? null

      let activeSchool: School | null = null
      let activeGroup: SchoolGroup | null = null
      let proprietorSchools: School[] | undefined = undefined
      let lecturerOfferings: LecturerOffering[] | undefined = undefined

      if (activeMembership?.school_id) {
        const { data } = await supabase
          .from('schools').select('*').eq('id', activeMembership.school_id).single()
        activeSchool = data
      } else if (activeMembership?.group_id) {
        const [{ data: grp }, { data: pSchools }] = await Promise.all([
          supabase.from('school_groups').select('*').eq('id', activeMembership.group_id).single(),
          supabase.from('schools').select('*').eq('group_id', activeMembership.group_id).order('name'),
        ])
        activeGroup = grp
        proprietorSchools = (pSchools ?? []) as School[]
      }

      // Capabilities held by the active office — drives write-control visibility.
      // (capabilities is a global reference table, readable by any authenticated user.)
      let capabilities: string[] = []
      const officeId = activeMembership?.office_id
      if (officeId && /^[0-9a-f-]{36}$/i.test(officeId)) {
        const { data: caps } = await supabase
          .from('capabilities').select('action').eq('office_id', officeId)
        capabilities = (caps ?? []).map((c: { action: string }) => c.action)
      }

      // Lecturer: load assigned course offerings for the sidebar
      if (activeMembership?.office?.name === 'lecturer' && activeMembership.id) {
        const { data: offs } = await supabase
          .from('course_offerings')
          .select('id, results_status, course:courses(code, title), semester:semesters(label, session:academic_sessions(label, is_active))')
          .eq('lecturer_membership_id', activeMembership.id)
          .order('id')
        lecturerOfferings = (offs ?? []) as unknown as LecturerOffering[]
      }

      if (mounted) {
        setAppUser({
          profile: profile as Profile,
          memberships: all,
          activeMembership,
          activeSchool,
          activeGroup,
          proprietorSchools,
          lecturerOfferings,
          capabilities,
        })
        setLoading(false)
      }
    }

    loadUser(activeMembershipId)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUser(activeMembershipId)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [activeMembershipId])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
    setAppUser(null)
  }

  function switchMembership(membershipId: string) {
    setActiveMembershipId(membershipId)
  }

  return { appUser, loading, signIn, signOut, switchMembership }
}
