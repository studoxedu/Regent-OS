import { useEffect, useState, useCallback } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea, Grid2 } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import type { AppUser, School } from '../../types'

interface Props { appUser: AppUser }

const BUCKET_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/school-logos`

type FormState = Pick<School,
  'name' | 'motto' | 'address' | 'city' | 'state' | 'phone' | 'email' |
  'website' | 'head_name' | 'registration_no' | 'established_year' | 'logo_url'>

const EMPTY: FormState = {
  name: '', motto: '', address: '', city: '', state: '', phone: '', email: '',
  website: '', head_name: '', registration_no: '', established_year: null, logo_url: null,
}

export default function SchoolProfile({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [form, setForm]       = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    if (!schoolId) return
    const { data } = await supabase.from('schools').select('*').eq('id', schoolId).single()
    if (data) {
      const s = data as School
      setForm({
        name: s.name ?? '', motto: s.motto ?? '', address: s.address ?? '', city: s.city ?? '',
        state: s.state ?? '', phone: s.phone ?? '', email: s.email ?? '', website: s.website ?? '',
        head_name: s.head_name ?? '', registration_no: s.registration_no ?? '',
        established_year: s.established_year ?? null, logo_url: s.logo_url ?? null,
      })
    }
    setLoading(false)
  }, [schoolId])

  useEffect(() => { load() }, [load])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) { flash('Logo must be under 2 MB.', 'error'); return }
    setUploading(true)
    const ext  = file.name.split('.').pop() || 'png'
    const path = `${schoolId}/logo_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('school-logos').upload(path, file, { upsert: true })
    if (error) { setUploading(false); flash(error.message, 'error'); return }
    const url = `${BUCKET_URL}/${path}`
    const { error: updErr } = await supabase.from('schools').update({ logo_url: url }).eq('id', schoolId)
    setUploading(false)
    if (updErr) { flash(updErr.message, 'error'); return }
    set('logo_url', url)
    flash('Logo updated.')
  }

  async function save() {
    if (!form.name.trim()) { flash('School name is required.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('schools').update({
      name:             form.name.trim(),
      motto:            form.motto?.trim() || null,
      address:          form.address?.trim() || null,
      city:             form.city?.trim() || null,
      state:            form.state?.trim() || null,
      phone:            form.phone?.trim() || null,
      email:            form.email?.trim() || null,
      website:          form.website?.trim() || null,
      head_name:        form.head_name?.trim() || null,
      registration_no:  form.registration_no?.trim() || null,
      established_year: form.established_year || null,
    }).eq('id', schoolId)
    setSaving(false)
    if (error) { flash(error.message, 'error'); return }
    flash('School profile saved.')
  }

  const initials = form.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading school profile…</div>

  return (
    <>
      <Topbar title="School Profile" meta={appUser.activeSchool?.name}
        actions={<Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>}
      />

      <div className="p-8 space-y-6 max-w-3xl">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Logo + identity */}
        <Card className="p-6">
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {form.logo_url
                ? <img src={form.logo_url} alt="School logo" className="w-full h-full object-contain" />
                : <span className="text-2xl font-bold text-gray-300">{initials || '—'}</span>}
            </div>
            <div>
              <div className="text-sm font-bold text-navy-900 mb-1">School Logo</div>
              <div className="text-xs text-gray-400 mb-3">Appears on report cards and printed documents. PNG/JPG, under 2 MB.</div>
              <label className="inline-block">
                <span className={`text-xs font-semibold px-3 py-1.5 rounded border border-navy-200 cursor-pointer hover:bg-navy-50 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploading ? 'Uploading…' : form.logo_url ? 'Replace Logo' : 'Upload Logo'}
                </span>
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
              </label>
            </div>
          </div>
        </Card>

        {/* Identity */}
        <Card>
          <CardHeader title="Identity" />
          <div className="p-5">
            <Grid2>
              <Field label="School Name" required>
                <Input value={form.name} onChange={e => set('name', e.target.value)} />
              </Field>
              <Field label="Motto">
                <Input value={form.motto ?? ''} onChange={e => set('motto', e.target.value)} placeholder="e.g. Knowledge and Character" />
              </Field>
            </Grid2>
            <Grid2>
              <Field label="Head Teacher / Principal" hint="Shown on report-card signatures">
                <Input value={form.head_name ?? ''} onChange={e => set('head_name', e.target.value)} />
              </Field>
              <Field label="Year Established">
                <Input type="number" value={form.established_year ?? ''} inputMode="numeric"
                  onChange={e => set('established_year', e.target.value ? parseInt(e.target.value) : null)} placeholder="e.g. 1998" />
              </Field>
            </Grid2>
            <Field label="Registration / Approval Number" hint="Government approval or registration number">
              <Input value={form.registration_no ?? ''} onChange={e => set('registration_no', e.target.value)} />
            </Field>
          </div>
        </Card>

        {/* Contact & address */}
        <Card>
          <CardHeader title="Contact & Address" />
          <div className="p-5">
            <Field label="Address">
              <Textarea rows={2} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
            </Field>
            <Grid2>
              <Field label="City / Town">
                <Input value={form.city ?? ''} onChange={e => set('city', e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={form.state ?? ''} onChange={e => set('state', e.target.value)} placeholder="e.g. Kano" />
              </Field>
            </Grid2>
            <Grid2>
              <Field label="Phone">
                <Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="e.g. 08012345678" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
              </Field>
            </Grid2>
            <Field label="Website">
              <Input value={form.website ?? ''} onChange={e => set('website', e.target.value)} placeholder="e.g. www.school.edu.ng" />
            </Field>
          </div>
        </Card>

        {/* Read-only, managed by platform */}
        <Card>
          <CardHeader title="Configuration" meta="Managed by the platform administrator" />
          <div className="p-5 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Tier</div>
              <div className="text-navy-900 capitalize">{appUser.activeSchool?.tier_id}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Stages</div>
              <div className="text-navy-900">{(appUser.activeSchool?.stages_offered ?? []).map(s => s.toUpperCase()).join(', ') || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Student Cap</div>
              <div className="text-navy-900">{appUser.activeSchool?.student_cap ?? 'Unlimited'}</div>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
