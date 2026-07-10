import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Field, Grid2 } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import type { AppUser, Guardian, GuardianLink, LearnerEnrollment } from '../../types'

interface Props { appUser: AppUser }

interface GuardianWithLinks extends Guardian {
  links: (GuardianLink & { learner_name: string; learner_id_code: string })[]
}

const RELATIONSHIPS = ['Father', 'Mother', 'Guardian', 'Sibling', 'Uncle', 'Aunt', 'Grandparent']

export default function Guardians({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id!

  const [guardians, setGuardians]     = useState<GuardianWithLinks[]>([])
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([])
  const [loading, setLoading]         = useState(true)
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Add guardian form
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState({ first_name: '', last_name: '', email: '', phone: '', nin: '' })
  const [saving, setSaving]       = useState(false)

  // Link guardian to learner
  const [linkGuardianId, setLinkGuardianId]   = useState<string | null>(null)
  const [linkEnrollmentId, setLinkEnrollmentId] = useState('')
  const [linkRelationship, setLinkRelationship] = useState('Guardian')
  const [linkIsPrimary, setLinkIsPrimary]       = useState(false)
  const [savingLink, setSavingLink]             = useState(false)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  async function loadData() {
    const [{ data: gs }, { data: links }, { data: en }] = await Promise.all([
      supabase.from('guardians').select('*').order('last_name').order('first_name'),
      supabase.from('guardian_links').select('*, learner:learners(first_name, last_name, learner_id)'),
      supabase.from('learner_enrollments').select('*, learner:learners(first_name, last_name, learner_id)')
        .eq('school_id', schoolId).eq('status', 'active').order('created_at'),
    ])

    const linksByGuardian = ((links ?? []) as any[]).reduce((acc: Record<string, any[]>, l) => {
      if (!acc[l.guardian_id]) acc[l.guardian_id] = []
      acc[l.guardian_id].push({
        ...l,
        learner_name: `${l.learner?.first_name ?? ''} ${l.learner?.last_name ?? ''}`.trim(),
        learner_id_code: l.learner?.learner_id ?? '',
      })
      return acc
    }, {})

    const enriched: GuardianWithLinks[] = ((gs ?? []) as Guardian[]).map(g => ({
      ...g,
      links: linksByGuardian[g.id] ?? [],
    }))

    setGuardians(enriched)
    setEnrollments((en ?? []) as LearnerEnrollment[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [schoolId])

  async function addGuardian() {
    if (!form.first_name.trim() || !form.last_name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('guardians').insert({
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim(),
      email:      form.email.trim() || null,
      phone:      form.phone.trim() || null,
      nin:        form.nin.trim() || null,
    })
    setSaving(false)
    if (error) { flash(error.message, 'error'); return }
    setForm({ first_name: '', last_name: '', email: '', phone: '', nin: '' })
    setShowForm(false)
    flash('Guardian added.')
    loadData()
  }

  async function linkGuardian() {
    if (!linkGuardianId || !linkEnrollmentId) return
    // Get learner_id from the selected enrollment
    const enrollment = enrollments.find(e => e.id === linkEnrollmentId)
    if (!enrollment) return
    setSavingLink(true)
    const { error } = await supabase.from('guardian_links').insert({
      guardian_id:  linkGuardianId,
      learner_id:   enrollment.learner_id,
      relationship: linkRelationship.toLowerCase(),
      is_primary:   linkIsPrimary,
    })
    setSavingLink(false)
    if (error) { flash(error.message, 'error'); return }
    setLinkGuardianId(null)
    setLinkEnrollmentId('')
    setLinkRelationship('Guardian')
    setLinkIsPrimary(false)
    flash('Guardian linked to learner.')
    loadData()
  }

  async function removeLink(linkId: string) {
    await supabase.from('guardian_links').delete().eq('id', linkId)
    flash('Link removed.')
    loadData()
  }

  return (
    <>
      <Topbar title="Guardians" meta={appUser.activeSchool?.name} />
      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-bold text-navy-900">Guardian Management</div>
            <div className="text-sm text-gray-400 mt-0.5">Register guardians and link them to learners for portal access</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowForm(v => !v)}>
            + Add Guardian
          </Button>
        </div>

        {showForm && (
          <Card className="p-5">
            <div className="text-sm font-bold text-navy-900 mb-4">New Guardian</div>
            <Grid2>
              <Field label="First Name" required>
                <Input placeholder="e.g. Emeka" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
              </Field>
              <Field label="Last Name" required>
                <Input placeholder="e.g. Okafor" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
              </Field>
              <Field label="Email Address">
                <Input type="email" placeholder="parent@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="Phone Number">
                <Input placeholder="e.g. 08012345678" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </Field>
              <Field label="NIN" hint="11-digit National Identification Number (optional)">
                <Input inputMode="numeric" maxLength={11} placeholder="11 digits" value={form.nin}
                  onChange={e => setForm(f => ({ ...f, nin: e.target.value.replace(/\D/g, '') }))} />
              </Field>
            </Grid2>
            <div className="text-xs text-gray-400 mt-2 mb-4">
              The email address is used for portal access. If no email is provided, the guardian cannot use the parent portal.
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={addGuardian} disabled={saving || !form.first_name || !form.last_name}>
                {saving ? 'Saving…' : 'Add Guardian'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        {/* Link modal */}
        {linkGuardianId && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
            <Card className="w-[440px] p-6 shadow-modal">
              <div className="text-base font-bold text-navy-900 mb-4">Link Guardian to Learner</div>
              <div className="space-y-4">
                <Field label="Learner" required>
                  <Select
                    value={linkEnrollmentId}
                    onChange={e => setLinkEnrollmentId(e.target.value)}
                    placeholder="Select learner…"
                    options={enrollments.map(en => ({
                      value: en.id,
                      label: `${en.learner?.first_name} ${en.learner?.last_name} (${en.learner?.learner_id})`,
                    }))}
                  />
                </Field>
                <Field label="Relationship">
                  <Select
                    value={linkRelationship}
                    onChange={e => setLinkRelationship(e.target.value)}
                    options={RELATIONSHIPS.map(r => ({ value: r, label: r }))}
                  />
                </Field>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={linkIsPrimary} onChange={e => setLinkIsPrimary(e.target.checked)}
                    className="rounded border-gray-300" />
                  <span className="text-sm text-navy-800">Primary guardian (receives all communications)</span>
                </label>
              </div>
              <div className="flex gap-2 mt-5">
                <Button variant="primary" onClick={linkGuardian} disabled={savingLink || !linkEnrollmentId}>
                  {savingLink ? 'Linking…' : 'Link Guardian'}
                </Button>
                <Button variant="ghost" onClick={() => setLinkGuardianId(null)}>Cancel</Button>
              </div>
            </Card>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : guardians.length === 0 ? (
          <Card className="py-16 text-center">
            <div className="text-sm font-semibold text-gray-500 mb-1">No guardians registered</div>
            <div className="text-xs text-gray-400">Add guardians and link them to learners to enable portal access.</div>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Registered Guardians" meta={`${guardians.length} total`} />
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Guardian', 'Contact', 'Linked Learners', ''].map(h => (
                    <th key={h} className={`px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 ${h === '' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guardians.map(g => (
                  <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-5 py-3">
                      <div className="text-sm font-semibold text-navy-900">{g.first_name} {g.last_name}</div>
                    </td>
                    <td className="px-5 py-3">
                      {g.email && <div className="text-xs text-navy-600">{g.email}</div>}
                      {g.phone && <div className="text-xs text-gray-400">{g.phone}</div>}
                      {!g.email && !g.phone && <span className="text-xs text-gray-300">No contact info</span>}
                    </td>
                    <td className="px-5 py-3">
                      {g.links.length === 0 ? (
                        <span className="text-xs text-gray-300">Not linked</span>
                      ) : (
                        <div className="space-y-1">
                          {g.links.map(l => (
                            <div key={l.id} className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-navy-800">{l.learner_name}</span>
                              <span className="text-[10px] text-gray-400 font-mono">{l.learner_id_code}</span>
                              <span className="text-[10px] capitalize text-gray-400">{l.relationship}</span>
                              {l.is_primary && <span className="text-[10px] font-bold text-amber-600 uppercase">Primary</span>}
                              <button onClick={() => removeLink(l.id)} className="text-gray-300 hover:text-red-400 text-[10px] ml-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setLinkGuardianId(g.id)}>
                        + Link Learner
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  )
}
