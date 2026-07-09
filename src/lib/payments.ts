import { supabase } from './supabase'

/**
 * Starts an online payment for a fee invoice via Paystack.
 * Returns the checkout URL to redirect the payer to.
 */
export async function startOnlinePayment(invoiceId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('paystack-init', {
    body: {
      invoice_id: invoiceId,
      // Paystack sends the payer back here with ?reference=… appended
      callback_url: window.location.href.split('?')[0],
    },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  if (!data?.authorization_url) throw new Error('Could not start payment')
  return data.authorization_url as string
}

/**
 * Confirms a payment after the Paystack redirect.
 * Returns the final status: 'success' | 'failed' | 'abandoned' | 'pending'.
 */
export async function verifyOnlinePayment(reference: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('paystack-verify', {
    body: { reference },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return (data?.status as string) ?? 'pending'
}
