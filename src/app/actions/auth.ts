"use server";

import { getStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/** Called by the login form right after Supabase accepts the password. */
export async function recordSignIn(): Promise<void> {
  const session = await getStaff();
  if (!session) return; // not on the staff list; the login page explains this
  await audit(createAdminClient(), { actor: session.userId, action: "staff.signed_in", entity: "staff", entity_id: session.userId, data: { email: session.email, role: session.staff.role } });
}

/** Called by the staff nav before the browser session is cleared. */
export async function recordSignOut(): Promise<void> {
  const session = await getStaff();
  if (!session) return;
  await audit(createAdminClient(), { actor: session.userId, action: "staff.signed_out", entity: "staff", entity_id: session.userId, data: { email: session.email, role: session.staff.role } });
}
