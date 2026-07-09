// Verifies a Paystack transaction after the checkout redirect and
// records the fee payment. Safe to call repeatedly.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json, recordSuccess, type PaymentTx } from '../_shared/paystack.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { reference } = await req.json()
    if (!reference) return json({ error: 'reference is required' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: tx } = await admin
      .from('payment_transactions')
      .select('id, school_id, invoice_id, reference, amount, status')
      .eq('reference', reference)
      .single()
    if (!tx) return json({ error: 'Unknown payment reference' }, 404)
    if (tx.status === 'success') return json({ status: 'success' })

    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}` } },
    )
    const verify = await verifyRes.json()
    const status = verify?.data?.status as string | undefined

    if (status === 'success') {
      await recordSuccess(admin, tx as PaymentTx, verify.data.paid_at ?? null, {
        channel: verify.data.channel,
        gateway_response: verify.data.gateway_response,
      })
      return json({ status: 'success' })
    }

    if (status === 'failed' || status === 'abandoned') {
      await admin.from('payment_transactions')
        .update({ status })
        .eq('id', tx.id)
        .eq('status', 'initialized')
      return json({ status })
    }

    return json({ status: status ?? 'pending' })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
