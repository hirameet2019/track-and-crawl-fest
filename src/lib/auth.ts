import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, homeFor, roleRank } from "@/lib/roles";
import type { StaffRole, StaffRow } from "@/lib/supabase/types";

export interface StaffSession {
  userId: string;
  email: string | null;
  staff: StaffRow;
}

/** Returns the logged-in staff member or null. */
export async function getStaff(): Promise<StaffSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("staff")
    .select("*")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return null;
  return { userId: user.id, email: user.email ?? null, staff };
}

/**
 * Redirects to /login when not signed in, or to the role's own home page when the
 * page needs more than the role has.
 */
export async function requireStaff(minRole: StaffRole = "scanner"): Promise<StaffSession> {
  const session = await getStaff();
  // Not on the staff list, or on it with a role this code does not know: say so
  // instead of bouncing silently (or in a loop between pages it cannot open).
  if (!session || roleRank(session.staff.role) === 0) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(user ? `/login?reason=not_staff&who=${encodeURIComponent(user.email ?? "")}` : "/login");
  }
  if (!hasRole(session.staff.role, minRole)) redirect(homeFor(session.staff.role));
  return session;
}

/** For server actions: throws instead of redirecting. */
export async function assertStaff(minRole: StaffRole = "scanner"): Promise<StaffSession> {
  const session = await getStaff();
  if (!session) throw new Error("Not signed in");
  if (!hasRole(session.staff.role, minRole)) throw new Error("Not allowed");
  return session;
}

/**
 * Numbers, Audit and Settings: an admin with system access (staff.system_access).
 * The organizer's other admins keep every other admin tool.
 */
export async function requireSystem(): Promise<StaffSession> {
  const session = await requireStaff("admin");
  if (!session.staff.system_access) redirect(homeFor(session.staff.role));
  return session;
}

/** Scan: any role from scanner up, unless the account has Scan turned off (staff.can_scan). */
export async function requireScan(): Promise<StaffSession> {
  const session = await requireStaff("scanner");
  if (session.staff.can_scan === false) redirect(homeFor(session.staff.role));
  return session;
}

/** For the scan actions: throws instead of redirecting. */
export async function assertScan(): Promise<StaffSession> {
  const session = await assertStaff("scanner");
  if (session.staff.can_scan === false) throw new Error("Not allowed");
  return session;
}

/** For the actions behind Numbers, Audit and Settings: throws instead of redirecting. */
export async function assertSystem(): Promise<StaffSession> {
  const session = await assertStaff("admin");
  if (!session.staff.system_access) throw new Error("Not allowed");
  return session;
}
