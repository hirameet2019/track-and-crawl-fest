import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS. Server-only. Every write in the app goes
 * through server actions that use this client after doing their own auth checks.
 *
 * Untyped on purpose for now: run
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/database.types.ts
 * once the project is linked, then pass the generated Database type here.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
