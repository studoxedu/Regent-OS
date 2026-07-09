// Initializes a Paystack transaction for a fee invoice.
// Called by the signed-in student/parent; returns the checkout URL.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/paystack.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { invoice_id, callback_url } = await req.json()
    if (!invoice_id) return json({ error: 'invoice_id is required' }, 400)

    // Identify the caller from their JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user?.email) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: invoice } = await admin
      .from('fee_invoices')
      .select('*')
      .eq('id', invoice_id)
      .single()
    if (!invoice) return json({ error: 'Invoice not found' }, 404)
    if (invoice.status === 'paid' || invoice.status === 'waived') {
      return json({ error: 'This invoice has already been settled' }, 400)
    }

    const outstanding = Number(invoice.amount_due) - Number(invoice.amount_paid)
    if (outstanding <= 0) return json({ error: 'Nothing left to pay on this invoice' }, 400)

    const reference = `ROS-${crypto.randomUUID()}`

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(outstanding * 100), // Paystack expects kobo
        currency: 'NGN',
        reference,
        callback_url: callback_url ?? undefined,
        metadata: { invoice_id, description: invoice.description },
      }),
    })
    const init = await initRes.json()
    if (!init.status || !init.data?.authorization_url) {
      return json({ error: init.message ?? 'Paystack initialization failed' }, 502)
    }

    await admin.from('payment_transactions').insert({
      school_id:         invoice.school_id,
      invoice_id,
      student_id:        invoice.student_id ?? null,
      profile_id:        user.id,
      provider:          'paystack',
      reference,
      amount:            outstanding,
      currency:          'NGN',
      status:            'initialized',
      authorization_url: init.data.authorization_url,
    })

    return json({ authorization_url: init.data.authorization_url, reference })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
