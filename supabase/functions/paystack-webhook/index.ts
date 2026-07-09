// Paystack webhook — the reliable path for payment confirmation.
// Configure https://<project>.supabase.co/functions/v1/paystack-webhook
// in the Paystack dashboard. Verified via x-paystack-signature (HMAC-SHA512).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { recordSuccess, type PaymentTx } from '../_shared/paystack.ts'

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const raw = await req.text()

  const signature = req.headers.get('x-paystack-signature')
  const expected  = await hmacSha512Hex(Deno.env.get('PAYSTACK_SECRET_KEY')!, raw)
  if (!signature || signature !== expected) {
    return new Response('Invalid signature', { status: 401 })
  }

  const event = JSON.parse(raw)
  if (event.event === 'charge.success') {
    const reference = event.data?.reference
    if (reference) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { data: tx } = await admin
        .from('payment_transactions')
        .select('id, school_id, invoice_id, reference, amount, status')
        .eq('reference', reference)
        .single()
      if (tx && tx.status !== 'success') {
        await recordSuccess(admin, tx as PaymentTx, event.data.paid_at ?? null, {
          channel: event.data.channel,
          gateway_response: event.data.gateway_response,
        })
      }
    }
  }

  return new Response('ok', { status: 200 })
})
