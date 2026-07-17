import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { notify } from '../../lib/notifications'
import { cn } from '../../lib/utils'
import type { AppUser, FeeCategory, FeeStructure, FeeInvoice, K12Term, InvoiceStatus, Stage } from '../../types'

interface Props { appUser: AppUser }

const STAGES: Stage[] = ['nursery','primary','jss','sss']
const INV_PAGE_SIZE = 25

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  unpaid:  'bg-red-50 text-red-600 border-red-200',
  partial: 'bg-yellow-50 text-yellow-600 border-yellow-200',
  paid:    'bg-green-50 text-green-600 border-green-200',
  waived:  'bg-gray-100 text-gray-500 border-gray-200',
}

export default function FeeManagement({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id!
  const [tab, setTab] = useState<'structures' | 'invoices' | 'payments'>('structures')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Data
  const [categories, setCategories]   = useState<FeeCategory[]>([])
  const [terms, setTerms]             = useState<K12Term[]>([])
  const [structures, setStructures]   = useState<FeeStructure[]>([])
  const [invoices, setInvoices]       = useState<FeeInvoice[]>([])
  const [invPage, setInvPage]         = useState(0)
  const [invTotal, setInvTotal]       = useState(0)
  const [totals, setTotals]           = useState({ due: 0, paid: 0 })

  // Category form
  const [catName, setCatName]         = useState('')
  const [savingCat, setSavingCat]     = useState(false)

  // Structure form
  const [strCat, setStrCat]     = useState('')
  const [strTerm, setStrTerm]   = useState('')
  const [strStage, setStrStage] = useState('')
  const [strAmount, setStrAmount] = useState('')
  const [strDue, setStrDue]     = useState('')
  const [savingStr, setSavingStr] = useState(false)

  // Payment modal
  const [payInvoice, setPayInvoice]   = useState<FeeInvoice | null>(null)
  const [payAmount, setPayAmount]     = useState('')
  const [payMethod, setPayMethod]     = useState('cash')
  const [payRef, setPayRef]           = useState('')
  const [savingPay, setSavingPay]     = useState(false)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  // School-wide fee totals. Must be a server-side aggregate — summing only the
  // rows on the current page would understate the school's position (the old
  // limit(100) had this bug silently).
  async function loadTotals() {
    // Via RPC — PostgREST aggregate functions are disabled on Supabase by
    // default, so amount_due.sum() 400s. RLS still applies inside the RPC.
    const { data } = await supabase
      .rpc('k12_fee_totals', { p_school_id: schoolId })
      .single()
    setTotals({
      due:  Number((data as any)?.total_due ?? 0),
      paid: Number((data as any)?.total_paid ?? 0),
    })
  }

  async function load() {
    loadTotals()
    const [{ data: cats }, { data: ts }, { data: strs }, { data: invs, count: invCount }] = await Promise.all([
      supabase.from('fee_categories').select('*').eq('school_id', schoolId).order('name'),
      supabase.from('k12_terms').select('*').eq('school_id', schoolId).order('created_at'),
      supabase.from('fee_structures').select('*, category:fee_categories(*), term:k12_terms(*)').eq('school_id', schoolId).order('created_at', { ascending: false }),
      supabase.from('fee_invoices')
        .select('*, enrollment:learner_enrollments(*, learner:learners(*))', { count: 'exact' })
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .range(invPage * INV_PAGE_SIZE, invPage * INV_PAGE_SIZE + INV_PAGE_SIZE - 1),
    ])
    setCategories((cats ?? []) as FeeCategory[])
    setTerms((ts ?? []) as K12Term[])
    setStructures((strs ?? []) as FeeStructure[])
    setInvoices((invs ?? []) as FeeInvoice[])
    setInvTotal(invCount ?? 0)
  }

  useEffect(() => { load() }, [schoolId, invPage])

  async function addCategory() {
    if (!catName.trim()) return
    setSavingCat(true)
    const { error } = await supabase.from('fee_categories').insert({ school_id: schoolId, name: catName.trim() })
    setSavingCat(false)
    if (error) { flash(error.message, 'error'); return }
    setCatName(''); flash('Category added.'); load()
  }

  async function addStructure() {
    if (!strCat || !strAmount) return
    setSavingStr(true)
    const { error } = await supabase.from('fee_structures').insert({
      school_id: schoolId,
      category_id: strCat,
      term_id: strTerm || null,
      stage: strStage || null,
      amount: parseFloat(strAmount),
      due_date: strDue || null,
    })
    setSavingStr(false)
    if (error) { flash(error.message, 'error'); return }
    setStrCat(''); setStrTerm(''); setStrStage(''); setStrAmount(''); setStrDue('')
    flash('Fee structure added.'); load()
  }

  async function generateInvoices(structureId: string) {
    // Generate invoices for all active learners matching this structure's stage
    const structure = structures.find(s => s.id === structureId)
    if (!structure) return

    let query = supabase.from('learner_enrollments')
      .select('id').eq('school_id', schoolId).eq('status', 'active')
    if (structure.stage) query = query.eq('stage', structure.stage)

    const { data: enrollments } = await query
    if (!enrollments?.length) { flash('No matching learners found.', 'error'); return }

    const invoiceRows = enrollments.map(en => ({
      school_id: schoolId,
      enrollment_id: en.id,
      fee_structure_id: structureId,
      description: `${structure.category?.name ?? 'Fee'}${structure.stage ? ' — ' + structure.stage.toUpperCase() : ''}`,
      amount_due: structure.amount,
      due_date: structure.due_date,
    }))

    const { error } = await supabase.from('fee_invoices').insert(invoiceRows)
    if (error) { flash(error.message, 'error'); return }
    flash(`${invoiceRows.length} invoices generated.`); load()
    setTab('invoices')
  }

  async function recordPayment() {
    if (!payInvoice || !payAmount || !payRef.trim()) return
    setSavingPay(true)
    const { error } = await supabase.from('fee_payments').insert({
      invoice_id: payInvoice.id,
      school_id: schoolId,
      amount: parseFloat(payAmount),
      receipt_ref: payRef.trim(),
      payment_method: payMethod,
    })
    setSavingPay(false)
    if (error) { flash(error.message, 'error'); return }
    printReceipt(payInvoice, parseFloat(payAmount), payRef.trim(), payMethod)
    notify(appUser.profile.id, schoolId, 'Fee payment recorded', {
      body: `₦${parseFloat(payAmount).toLocaleString('en-NG')} received · Ref ${payRef.trim()}`,
      type: 'success',
      link: '/k12/fee-management',
    })
    setPayInvoice(null); setPayAmount(''); setPayRef(''); setPayMethod('cash')
    flash('Payment recorded.'); load()
  }

  function printReceipt(invoice: FeeInvoice, amount: number, ref: string, method: string) {
    const learner = (invoice.enrollment as any)?.learner
    const schoolName = appUser.activeSchool?.name ?? 'School'
    const now = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    const win = window.open('', '_blank', 'width=420,height=560')
    if (!win) return
    win.document.write(`
      <html><head><title>Receipt ${ref}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Courier New', monospace; font-size: 12px; padding: 24px; width: 360px; color: #111; }
        h1 { font-size: 16px; text-align: center; margin-bottom: 2px; }
        .sub { text-align: center; color: #555; margin-bottom: 16px; font-size: 11px; }
        .divider { border-top: 1px dashed #999; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin: 4px 0; }
        .label { color: #555; }
        .amount { font-size: 20px; font-weight: bold; text-align: center; margin: 12px 0; }
        .footer { text-align: center; margin-top: 16px; color: #888; font-size: 10px; }
      </style></head>
      <body>
        <h1>${schoolName}</h1>
        <div class="sub">OFFICIAL PAYMENT RECEIPT</div>
        <div class="divider"></div>
        <div class="row"><span class="label">Receipt Ref:</span><span><b>${ref}</b></span></div>
        <div class="row"><span class="label">Date:</span><span>${now}</span></div>
        <div class="divider"></div>
        <div class="row"><span class="label">Learner:</span><span>${learner?.first_name ?? ''} ${learner?.last_name ?? ''}</span></div>
        <div class="row"><span class="label">ID:</span><span>${learner?.learner_id ?? ''}</span></div>
        <div class="row"><span class="label">Description:</span><span>${invoice.description}</span></div>
        <div class="divider"></div>
        <div class="amount">₦${amount.toLocaleString()}</div>
        <div class="row"><span class="label">Method:</span><span>${method.toUpperCase()}</span></div>
        <div class="row"><span class="label">Balance After:</span><span>₦${(invoice.amount_due - invoice.amount_paid - amount).toLocaleString()}</span></div>
        <div class="divider"></div>
        <div class="footer">Thank you. Keep this receipt for your records.<br>Powered by Regent OS</div>
        <script>window.onload = () => { window.print(); }<\/script>
      </body></html>
    `)
    win.document.close()
  }

  // School-wide (all invoices), not just the visible page — see loadTotals().
  const totalDue  = totals.due
  const totalPaid = totals.paid
  const totalOwed = totalDue - totalPaid

  return (
    <>
      <Topbar title="Fee Management" meta={appUser.activeSchool?.name} />

      {payInvoice && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <Card className="w-[440px] p-6 shadow-modal">
            <div className="text-base font-bold text-navy-900 mb-1">Record Payment</div>
            <div className="text-xs text-gray-400 mb-4">
              {(payInvoice.enrollment as any)?.learner?.first_name} {(payInvoice.enrollment as any)?.learner?.last_name}
              {' '}· {payInvoice.description}
            </div>
            <div className="space-y-3">
              <div>
                <label className="label mb-1.5 block">Amount (₦)</label>
                <Input type="number" placeholder={`Balance: ₦${(payInvoice.amount_due - payInvoice.amount_paid).toLocaleString()}`}
                  value={payAmount} onChange={e => setPayAmount(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">Receipt Reference</label>
                <Input placeholder="e.g. RCP-2025-001" value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1.5 block">Payment Method</label>
                <Select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                  options={[{value:'cash',label:'Cash'},{value:'transfer',label:'Bank Transfer'},{value:'pos',label:'POS'},{value:'cheque',label:'Cheque'}]} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="primary" onClick={recordPayment} disabled={savingPay}>
                {savingPay ? 'Recording…' : 'Record Payment'}
              </Button>
              <Button variant="ghost" onClick={() => setPayInvoice(null)}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}

      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Invoiced', value: `₦${totalDue.toLocaleString()}`, color: 'border-t-blue-500' },
            { label: 'Total Collected', value: `₦${totalPaid.toLocaleString()}`, color: 'border-t-green-600' },
            { label: 'Outstanding', value: `₦${totalOwed.toLocaleString()}`, color: 'border-t-red-500' },
          ].map(s => (
            <div key={s.label} className={cn('bg-white border border-gray-200 rounded-sm p-5 border-t-2', s.color)}>
              <div className="label mb-2">{s.label}</div>
              <div className="text-[24px] font-bold text-navy-900">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(['structures','invoices','payments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-navy-800 text-navy-900' : 'border-transparent text-gray-400 hover:text-navy-700'}`}>
              {t === 'structures' ? 'Fee Setup' : t === 'invoices' ? 'Invoices' : 'Payments'}
            </button>
          ))}
        </div>

        {tab === 'structures' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {/* Categories */}
              <Card className="p-5">
                <div className="text-sm font-bold text-navy-900 mb-4">Fee Categories</div>
                <div className="flex gap-2 mb-4">
                  <Input placeholder="e.g. School Fees, PTA Levy" value={catName}
                    onChange={e => setCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} />
                  <Button variant="primary" size="sm" onClick={addCategory} disabled={savingCat}>Add</Button>
                </div>
                <div className="space-y-1">
                  {categories.map(cat => (
                    <div key={cat.id} className="px-3 py-2 bg-gray-50 rounded-sm text-sm text-navy-800 font-medium">{cat.name}</div>
                  ))}
                  {categories.length === 0 && <div className="text-xs text-gray-400">No categories yet.</div>}
                </div>
              </Card>

              {/* Add structure */}
              <Card className="p-5">
                <div className="text-sm font-bold text-navy-900 mb-4">Add Fee Structure</div>
                <div className="space-y-3">
                  <div>
                    <label className="label mb-1 block">Category</label>
                    <Select value={strCat} onChange={e => setStrCat(e.target.value)}
                      options={[{value:'',label:'Select category…'}, ...categories.map(c => ({value:c.id,label:c.name}))]} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label mb-1 block">Term (optional)</label>
                      <Select value={strTerm} onChange={e => setStrTerm(e.target.value)}
                        options={[{value:'',label:'All terms'}, ...terms.map(t => ({value:t.id,label:t.label}))]} />
                    </div>
                    <div>
                      <label className="label mb-1 block">Stage (optional)</label>
                      <Select value={strStage} onChange={e => setStrStage(e.target.value)}
                        options={[{value:'',label:'All stages'}, ...STAGES.map(s => ({value:s,label:s.toUpperCase()}))]} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label mb-1 block">Amount (₦)</label>
                      <Input type="number" placeholder="0.00" value={strAmount} onChange={e => setStrAmount(e.target.value)} />
                    </div>
                    <div>
                      <label className="label mb-1 block">Due Date</label>
                      <Input type="date" value={strDue} onChange={e => setStrDue(e.target.value)} />
                    </div>
                  </div>
                  <Button variant="primary" size="sm" onClick={addStructure} disabled={savingStr || !strCat || !strAmount}>
                    {savingStr ? 'Saving…' : 'Add Structure'}
                  </Button>
                </div>
              </Card>
            </div>

            {/* Structures list */}
            <Card>
              <CardHeader title="Fee Structures" meta={`${structures.length} configured`} />
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Category', 'Term', 'Stage', 'Amount', 'Due Date', ''].map(h => (
                      <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {structures.map(str => (
                    <tr key={str.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">{str.category?.name}</td>
                      <td className="px-5 py-3 text-sm text-gray-600">{str.term?.label ?? 'All terms'}</td>
                      <td className="px-5 py-3 text-sm text-gray-600">{str.stage ? str.stage.toUpperCase() : 'All stages'}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">₦{str.amount.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{str.due_date ?? '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="secondary" size="sm" onClick={() => generateInvoices(str.id)}>
                          Generate Invoices
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {structures.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-400">No fee structures yet.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {tab === 'invoices' && (
          <Card>
            <CardHeader title="Fee Invoices" meta={invTotal > 0
              ? `${invPage * INV_PAGE_SIZE + 1}–${Math.min((invPage + 1) * INV_PAGE_SIZE, invTotal)} of ${invTotal}`
              : '0 total'} />
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Learner', 'Description', 'Due', 'Paid', 'Balance', 'Status', ''].map(h => (
                    <th key={h} className={cn('px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500', h===''?'text-right':'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const learner = (inv.enrollment as any)?.learner
                  const balance = inv.amount_due - inv.amount_paid
                  return (
                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3">
                        <div className="text-sm font-semibold text-navy-900">{learner?.first_name} {learner?.last_name}</div>
                        <div className="text-xs font-mono text-gray-400">{learner?.learner_id}</div>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">{inv.description}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">₦{inv.amount_due.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm text-green-600">₦{inv.amount_paid.toLocaleString()}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-red-500">₦{balance.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <span className={cn('px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wide', STATUS_STYLE[inv.status])}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {inv.status !== 'paid' && inv.status !== 'waived' && (
                            <Button variant="primary" size="sm" onClick={() => { setPayInvoice(inv); setPayAmount(String(balance)) }}>
                              Pay
                            </Button>
                          )}
                          {inv.amount_paid > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => printReceipt(inv, inv.amount_paid, `RCP-${inv.id.slice(0,8).toUpperCase()}`, 'cash')}>
                              Receipt
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {invoices.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">No invoices yet. Generate from a fee structure.</td></tr>
                )}
              </tbody>
            </table>

            {invTotal > INV_PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200">
                <span className="text-xs text-gray-400">
                  Page {invPage + 1} of {Math.ceil(invTotal / INV_PAGE_SIZE)}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={invPage === 0}
                    onClick={() => setInvPage(p => Math.max(0, p - 1))}>
                    ← Prev
                  </Button>
                  <Button variant="ghost" size="sm"
                    disabled={(invPage + 1) * INV_PAGE_SIZE >= invTotal}
                    onClick={() => setInvPage(p => p + 1)}>
                    Next →
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {tab === 'payments' && (
          <Card>
            <CardHeader title="Payment History" />
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              Payment history coming soon. Use the Invoices tab to record payments.
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
