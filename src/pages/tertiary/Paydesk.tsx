import { useEffect, useState } from 'react'
import { flowExecute, supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Student {
  id: string
  first_name: string
  last_name: string
  reg_number: string
}

interface Invoice {
  id: string
  description: string
  amount_due: number
  amount_paid: number
  status: string
  due_date: string | null
  student: { first_name: string; last_name: string; reg_number: string } | null
  created_at: string
}

interface Payment {
  id: string
  amount: number
  receipt_ref: string
  payment_method: string
  recorded_at: string
}

const STATUS_COLORS: Record<string,string> = {
  unpaid:  'text-red-700 bg-red-50 border-red-200',
  partial: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  paid:    'text-green-700 bg-green-50 border-green-200',
  waived:  'text-gray-500 bg-gray-50 border-gray-200',
}

export default function Paydesk({ appUser }: { appUser: AppUser }) {
  const schoolId = appUser.activeSchool?.id

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Create Invoice modal
  const [createModal, setCreateModal] = useState(false)
  const [students, setStudents] = useState<Student[]>([])
  const [iStudentId, setIStudentId] = useState('')
  const [iDesc, setIDesc] = useState('')
  const [iAmount, setIAmount] = useState('')
  const [iDue, setIDue] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // Payment modal
  const [payModal, setPayModal] = useState<Invoice | null>(null)
  const [pAmount, setPAmount] = useState('')
  const [pRef, setPRef] = useState('')
  const [pMethod, setPMethod] = useState('cash')
  const [paying, setPaying] = useState(false)
  const [payErr, setPayErr] = useState('')

  // Payments history
  const [histModal, setHistModal] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])

  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => { loadInvoices() }, [schoolId])

  async function loadInvoices() {
    if (!schoolId) return
    setLoading(true)
    const { data } = await supabase
      .from('fee_invoices')
      .select('id, description, amount_due, amount_paid, status, due_date, created_at, student:students!student_id(first_name,last_name,reg_number)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
    setInvoices((data ?? []) as unknown as Invoice[])
    setLoading(false)
  }

  async function openCreate() {
    // students are keyed by institution_id, not school_id — the old query
    // referenced a non-existent column, so the picker was always empty.
    const { data } = await supabase
      .from('students')
      .select('id, first_name, last_name, reg_number')
      .eq('institution_id', schoolId)
      .eq('status', 'active')
      .order('reg_number')
    setStudents((data ?? []) as Student[])
    setIStudentId(''); setIDesc(''); setIAmount(''); setIDue('')
    setCreateErr('')
    setCreateModal(true)
  }

  async function createInvoice() {
    if (!iStudentId || !iDesc.trim() || !iAmount) { setCreateErr('Fill all required fields.'); return }
    if (!schoolId) return
    setCreating(true); setCreateErr('')
    try {
      await flowExecute('fee.invoice_create', schoolId, {
        student_id: iStudentId,
        description: iDesc.trim(),
        amount_due: parseFloat(iAmount),
        due_date: iDue || null,
      })
    } catch (err) {
      setCreating(false)
      setCreateErr(err instanceof Error ? err.message : 'Could not create invoice')
      return
    }
    setCreating(false)
    setCreateModal(false)
    loadInvoices()
  }

  async function recordPayment() {
    if (!payModal || !pAmount || !schoolId) { setPayErr('Enter an amount.'); return }
    setPaying(true); setPayErr('')
    try {
      await flowExecute('fee.payment_record', schoolId, {
        invoice_id: payModal.id,
        amount: parseFloat(pAmount),
        receipt_ref: pRef || null,
        payment_method: pMethod,
      })
    } catch (err) {
      setPaying(false)
      setPayErr(err instanceof Error ? err.message : 'Could not record payment')
      return
    }
    setPaying(false)
    setPayModal(null)
    loadInvoices()
  }

  async function waiveInvoice(inv: Invoice) {
    if (!schoolId) return
    if (!confirm(`Waive invoice "${inv.description}"?`)) return
    try {
      await flowExecute('fee.waive', schoolId, { invoice_id: inv.id })
    } catch (err) {
      // this used to swallow the error entirely — a failed waive looked like a success
      setToast(err instanceof Error ? err.message : 'Could not waive invoice')
      return
    }
    loadInvoices()
  }

  async function openHistory(inv: Invoice) {
    setHistModal(inv)
    const { data } = await supabase
      .from('fee_payments')
      .select('id, amount, receipt_ref, payment_method, recorded_at')
      .eq('invoice_id', inv.id)
      .order('recorded_at', { ascending: false })
    setPayments((data ?? []) as Payment[])
  }

  const filtered = invoices.filter(inv => {
    if (filterStatus !== 'all' && inv.status !== filterStatus) return false
    const q = search.toLowerCase()
    if (!q) return true
    const student = inv.student
    return (
      inv.description.toLowerCase().includes(q) ||
      student?.first_name?.toLowerCase().includes(q) ||
      student?.last_name?.toLowerCase().includes(q) ||
      student?.reg_number?.toLowerCase().includes(q)
    )
  })

  const totals = invoices.reduce((a, inv) => ({
    due: a.due + inv.amount_due,
    paid: a.paid + inv.amount_paid,
  }), { due: 0, paid: 0 })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[20px] font-bold text-navy-900">Paydesk</h1>
        <button onClick={openCreate}
          className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600">
          + New Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Invoiced', value: totals.due },
          { label: 'Total Collected', value: totals.paid },
          { label: 'Outstanding', value: totals.due - totals.paid },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-100 rounded-lg px-4 py-3">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{card.label}</div>
            <div className="text-[18px] font-bold text-navy-900">
              ₦{card.value.toLocaleString('en', { minimumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student or description…"
          className="border border-gray-200 rounded px-3 py-1.5 text-[13px] flex-1" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-[13px]">
          <option value="all">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-[13px] text-gray-400">Loading…</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-gray-200">
              {['Student','Description','Amount Due','Paid','Status','Due',''].map(h => (
                <th key={h} className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => (
              <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5">
                  {inv.student ? (
                    <div>
                      <div className="font-medium text-navy-900">{inv.student.first_name} {inv.student.last_name}</div>
                      <div className="text-[11px] text-gray-400">{inv.student.reg_number}</div>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="py-2.5 text-navy-900">{inv.description}</td>
                <td className="py-2.5 font-medium text-navy-900">₦{inv.amount_due.toLocaleString()}</td>
                <td className="py-2.5 text-gray-600">₦{inv.amount_paid.toLocaleString()}</td>
                <td className="py-2.5">
                  <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold capitalize ${STATUS_COLORS[inv.status] ?? ''}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="py-2.5 text-gray-400 text-[12px]">
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-GB') : '—'}
                </td>
                <td className="py-2.5">
                  <div className="flex gap-1">
                    {inv.status !== 'paid' && inv.status !== 'waived' && (
                      <>
                        <button onClick={() => { setPAmount(''); setPRef(''); setPMethod('cash'); setPayErr(''); setPayModal(inv) }}
                          className="px-2 py-0.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded cursor-pointer hover:bg-amber-100">
                          Pay
                        </button>
                        <button onClick={() => waiveInvoice(inv)}
                          className="px-2 py-0.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded cursor-pointer hover:bg-gray-100">
                          Waive
                        </button>
                      </>
                    )}
                    <button onClick={() => openHistory(inv)}
                      className="px-2 py-0.5 text-[11px] text-navy-600 bg-navy-50 border border-navy-200 rounded cursor-pointer hover:bg-navy-100">
                      History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">No invoices found.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* Create Invoice Modal */}
      {createModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">New Invoice</h2>
            {createErr && <div className="mb-3 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{createErr}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Student <span className="text-red-500">*</span></label>
                <select value={iStudentId} onChange={e => setIStudentId(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]">
                  <option value="">Select student…</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.reg_number})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Description <span className="text-red-500">*</span></label>
                <input value={iDesc} onChange={e => setIDesc(e.target.value)} placeholder="e.g. Tuition Fee — 2025/2026 1st Semester"
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount (₦) <span className="text-red-500">*</span></label>
                  <input value={iAmount} onChange={e => setIAmount(e.target.value)} type="number" placeholder="0.00"
                    className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                  <input value={iDue} onChange={e => setIDue(e.target.value)} type="date"
                    className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCreateModal(false)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Cancel</button>
              <button onClick={createInvoice} disabled={creating}
                className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-1">Record Payment</h2>
            <p className="text-[13px] text-gray-500 mb-4">{payModal.description}</p>
            <div className="text-[12px] text-gray-500 mb-4">
              Outstanding: ₦{(payModal.amount_due - payModal.amount_paid).toLocaleString()}
            </div>
            {payErr && <div className="mb-3 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{payErr}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount (₦) <span className="text-red-500">*</span></label>
                <input value={pAmount} onChange={e => setPAmount(e.target.value)} type="number" placeholder="0.00"
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Receipt Ref</label>
                <input value={pRef} onChange={e => setPRef(e.target.value)} placeholder="Optional"
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Method</label>
                <select value={pMethod} onChange={e => setPMethod(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]">
                  <option value="cash">Cash</option>
                  <option value="transfer">Bank Transfer</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPayModal(null)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Cancel</button>
              <button onClick={recordPayment} disabled={paying}
                className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600 disabled:opacity-50">
                {paying ? 'Recording…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {histModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-1">Payment History</h2>
            <p className="text-[13px] text-gray-500 mb-4">{histModal.description}</p>
            {payments.length === 0 ? (
              <p className="text-[13px] text-gray-400">No payments recorded.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500">Date</th>
                    <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500">Amount</th>
                    <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500">Method</th>
                    <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-2">{new Date(p.recorded_at).toLocaleDateString('en-GB')}</td>
                      <td className="py-2 font-medium text-navy-900">₦{p.amount.toLocaleString()}</td>
                      <td className="py-2 capitalize text-gray-600">{p.payment_method}</td>
                      <td className="py-2 text-gray-400">{p.receipt_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setHistModal(null)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-lg text-sm z-50"
          onClick={() => setToast(null)}>{toast}</div>
      )}
    </div>
  )
}
