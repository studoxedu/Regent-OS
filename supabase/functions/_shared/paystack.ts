// Shared helpers for the Paystack edge functions.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export interface PaymentTx {
  id: string
  school_id: string | null
  invoice_id: string | null
  reference: string
  amount: number
  status: string
}

/**
 * Marks a transaction successful and records the fee payment.
 * Idempotent: the conditional update only succeeds once, so the webhook
 * and the redirect-verify can both call this safely.
 */
export async function recordSuccess(
  admin: SupabaseClient,
  tx: PaymentTx,
  paidAt: string | null,
  metadata: Record<string, unknown> | null,
) {
  const { data: updated } = await admin
    .from('payment_transactions')
    .update({ status: 'success', paid_at: paidAt ?? new Date().toISOString(), metadata })
    .eq('id', tx.id)
    .eq('status', 'initialized')
    .select('id')

  if (!updated || updated.length === 0) return // already recorded by the other path

  if (tx.invoice_id) {
    await admin.from('fee_payments').insert({
      invoice_id:     tx.invoice_id,
      school_id:      tx.school_id,
      amount:         tx.amount,
      receipt_ref:    tx.reference,
      payment_method: 'paystack',
    })
  }
}
