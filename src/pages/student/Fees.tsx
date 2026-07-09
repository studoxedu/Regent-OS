import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { startOnlinePayment, verifyOnlinePayment } from '../../lib/payments'
import { useStudentContext } from '../../hooks/useStudentContext'
import { cn } from '../../lib/utils'
import type { AppUser } from '../../types'

interface Props { appUser: AppUser }

interface Invoice {
  id: string
  description: string | null
  amount_due: number
  amount_paid: number
  status: string
  due_date: string | null
  created_at: string
}

export default function StudentFees({ appUser }: Props) {
  const ctx = useStudentContext(appUser)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading]   = useState(true)
  const [paying, setPaying]     = useState<string | null>(null)
  const [banner, setBanner]     = useState<{ msg: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!ctx.studentId) return
    const { data } = await supabase.from('fee_invoices')
      .select('id, description, amount_due, amount_paid, status, due_date, created_at')
      .eq('student_id', ctx.studentId)
      .order('created_at', { ascending: false })
    setInvoices((data ?? []) as Invoice[])
    setLoading(false)
  }, [ctx.studentId])

  useEffect(() => { load() }, [load])

  // Returning from Paystack checkout: ?reference=… (or trxref) is appended
  useEffect(() => {
    const params    = new URLSearchParams(window.location.search)
    const reference = params.get('reference') ?? params.get('trxref')
    if (!reference) return
    window.history.replaceState({}, '', window.location.pathname)
    verifyOnlinePayment(reference)
      .then(status => {
        if (status === 'success') {
          setBanner({ msg: 'Payment received — your invoice has been updated.', ok: true })
        } else if (status === 'pending') {
          setBanner({ msg: 'Payment is still processing. Refresh in a moment.', ok: true })
        } else {
          setBanner({ msg: `Payment ${status}. You have not been charged, or contact the bursary.`, ok: false })
        }
        load()
      })
      .catch(e => setBanner({ msg: e.message, ok: false }))
  }, [load])

  async function payNow(invoiceId: string) {
    setPaying(invoiceId)
    try {
      const url = await startOnlinePayment(invoiceId)
      window.location.assign(url)
    } catch (e) {
      setBanner({ msg: e instanceof Error ? e.message : 'Could not start payment', ok: false })
      setPaying(null)
    }
  }

  const totalDue    = invoices.reduce((s, i) => s + i.amount_due,  0)
  const totalPaid   = invoices.reduce((s, i) => s + i.amount_paid, 0)
  const outstanding = totalDue - totalPaid

  function statusColor(s: string) {
    if (s === 'paid')    return 'bg-green-100 text-green-700'
    if (s === 'partial') return 'bg-amber-100 text-amber-700'
    if (s === 'waived')  return 'bg-gray-100 text-gray-500'
    return 'bg-red-100 text-red-600'
  }

  if (ctx.loading || loading) return <div className="p-8 text-sm text-gray-400">Loading fees…</div>

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="text-xl font-bold text-navy-900">Fees</div>

      {banner && (
        <div className={cn(
          'text-sm rounded-sm border px-4 py-3',
          banner.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
        )}>
          {banner.msg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Charged', value: `₦${totalDue.toLocaleString()}`,         color: 'text-navy-900' },
          { label: 'Total Paid',    value: `₦${totalPaid.toLocaleString()}`,         color: 'text-green-600' },
          { label: 'Outstanding',   value: `₦${outstanding.toLocaleString()}`,       color: outstanding > 0 ? 'text-red-600' : 'text-green-600' },
        ].map(s => (
          <Card key={s.label} className="p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{s.label}</div>
            <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Invoice list */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-bold text-navy-900">Invoices</div>
        </div>
        {invoices.length === 0 ? (
          <div className="px-5 py-10 text-sm text-gray-400 text-center">No fee invoices found.</div>
        ) : (
          invoices.map(inv => {
            const payable = inv.status === 'unpaid' || inv.status === 'partial'
            return (
              <div key={inv.id} className="px-5 py-4 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-navy-900 truncate">{inv.description ?? 'Fee Invoice'}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-navy-900">₦{inv.amount_due.toLocaleString()}</div>
                    {inv.amount_paid > 0 && (
                      <div className="text-xs text-green-600">Paid: ₦{inv.amount_paid.toLocaleString()}</div>
                    )}
                  </div>
                  <span className={cn('text-[11px] font-bold px-2 py-1 rounded capitalize', statusColor(inv.status))}>
                    {inv.status}
                  </span>
                  {payable && (
                    <Button variant="amber" size="sm" onClick={() => payNow(inv.id)} disabled={paying !== null}>
                      {paying === inv.id ? 'Redirecting…' : 'Pay Now'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </Card>

      <div className="text-[11px] text-gray-400">
        Online payments are processed securely by Paystack. Your invoice updates automatically once payment is confirmed.
      </div>
    </div>
  )
}
