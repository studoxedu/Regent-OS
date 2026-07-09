import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://fghdgtihpvaehykgqgro.supabase.co',
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const TERTIARY_SCHOOL_ID = '00000000-0000-0000-0000-000000000003'

async function main() {
  // 1. Create auth user
  const { data: userData, error: authErr } = await supabase.auth.admin.createUser({
    email: 'tertiary@regentos.test',
    password: 'haidarbuilds2026!',
    email_confirm: true,
    user_metadata: { first_name: 'School', last_name: 'Admin' },
  })

  if (authErr && !authErr.message.includes('already been registered')) {
    throw new Error('Auth error: ' + authErr.message)
  }

  let userId = userData?.user?.id

  if (!userId) {
    // User already exists — list and find
    const { data: list } = await supabase.auth.admin.listUsers()
    userId = list?.users?.find(u => u.email === 'tertiary@regentos.test')?.id
    if (!userId) throw new Error('Could not find user')
    console.log('✓ User already existed:', userId)
  } else {
    console.log('✓ Auth user created:', userId)
  }

  // 2. Profile
  const { error: profileErr } = await supabase.from('profiles').upsert({
    id: userId,
    email: 'tertiary@regentos.test',
    first_name: 'School',
    last_name: 'Admin',
  })
  if (profileErr) throw new Error('Profile: ' + profileErr.message)
  console.log('✓ Profile row')

  // 3. Membership as school_admin at tertiary school
  const { data: office } = await supabase.from('offices').select('id').eq('name', 'school_admin').single()
  if (!office) throw new Error('office not found')

  const { error: memErr } = await supabase.from('memberships').upsert({
    profile_id: userId,
    school_id: TERTIARY_SCHOOL_ID,
    office_id: office.id,
  }, { onConflict: 'profile_id,school_id,office_id', ignoreDuplicates: true })
  if (memErr) throw new Error('Membership: ' + memErr.message)
  console.log('✓ Membership: school_admin @ Regentos Polytechnic')

  console.log('\nTertiary user ready:')
  console.log('  Email   : tertiary@regentos.test')
  console.log('  Password: haidarbuilds2026!')
  console.log('  Office  : school_admin')
  console.log('  School  : Regentos Polytechnic (ND / HND)')
  console.log('\nSign in at http://localhost:5173')
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
