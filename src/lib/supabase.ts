import { createClient } from '@supabase/supabase-js'
import type { FlowExecuteResult } from '../types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly — never silently fall back to a placeholder URL, which
  // produces confusing auth/network errors later instead of a clear cause.
  throw new Error(
    '[Regent OS] Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — locally in .env.local, ' +
    'or in your hosting provider (e.g. Vercel) project settings — then rebuild. ' +
    'The app cannot start without them.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/** The only write path for governance data. */
export async function flowExecute(
  actionType: string,
  schoolId: string,
  payload: Record<string, unknown> = {}
): Promise<FlowExecuteResult> {
  const { data, error } = await supabase.rpc('flow_execute', {
    p_action_type: actionType,
    p_school_id: schoolId,
    p_payload: payload,
  })
  if (error) throw new Error(error.message)
  return data as FlowExecuteResult
}
