import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

const ROLE_RANK: Record<StaffRole, number> = { scanner: 1, staff: 2, admin: 3 };

/** Redirects to /login when not signed in, or to /scan when the role is too low. */
export async function requireStaff(minRole: StaffRole = "scanner"): Promise<StaffSession> {
  const session = await getStaff();
  if (!session) {
    // Signed in to Supabase Auth but not on the staff list: say so instead of bouncing silently.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(user ? `/login?reason=not_staff&who=${encodeURIComponent(user.email ?? "")}` : "/login");
  }
  if (ROLE_RANK[session.staff.role] < ROLE_RANK[minRole]) redirect("/scan");
  return session;
}

/** For server actions: throws instead of redirecting. */
export async function assertStaff(minRole: StaffRole = "scanner"): Promise<StaffSession> {
  const session = await getStaff();
  if (!session) throw new Error("Not signed in");
  if (ROLE_RANK[session.staff.role] < ROLE_RANK[minRole]) throw new Error("Not allowed");
  return session;
}
