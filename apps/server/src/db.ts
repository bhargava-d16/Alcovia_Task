import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root when running npm scripts
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
// Fallback: load from server directory if not found
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
    'Copy apps/server/.env.example to apps/server/.env and fill in your values.',
  );
}

/**
 * Supabase client using the SERVICE ROLE KEY.
 *
 * WHY service role on the backend:
 * - Service role bypasses Row Level Security (which we've disabled anyway for
 *   this demo, but would matter in production)
 * - The frontend client would use the ANON key with RLS policies
 * - The backend is the only entity that should write rewards/stats —
 *   using service role makes this clear and enforceable
 *
 * NEVER expose the service role key to the frontend.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
