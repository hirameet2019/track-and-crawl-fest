import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALL_PERMISSIONS, cleanPermissions, homeFor, legacyAccess, type Permission } from "@/lib/roles";
import type { RoleRow, StaffRow } from "@/lib/supabase/types";

export interface StaffSession {
  userId: string;
  email: string | null;
  staff: StaffRow;
  /** The account's role; id is null for an account still on the old role columns. */
  role: { id: string | null; name: string; owner: boolean };
  permissions: Permission[];
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
  const { role, permissions } = await accessFor(admin, staff as StaffRow);
  return { userId: user.id, email: user.email ?? null, staff, role, permissions };
}

/** The role behind role_id, or the old role columns when there is none (or the roles table is not there yet). */
async function accessFor(admin: SupabaseClient, staff: StaffRow): Promise<Pick<StaffSession, "role" | "permissions">> {
  if (staff.role_id) {
    const { data } = await admin.from("roles").select("*").eq("id", staff.role_id).maybeSingle<RoleRow>();
    if (data) {
      return {
        role: { id: data.id, name: data.name, owner: data.is_owner },
        permissions: data.is_owner ? ALL_PERMISSIONS : cleanPermissions(data.permissions ?? []),
      };
    }
  }
  const legacy = legacyAccess(staff);
  return { role: { id: null, name: legacy.name, owner: legacy.owner }, permissions: legacy.permissions };
}

export function can(session: Pick<StaffSession, "permissions">, ...any: Permission[]): boolean {
  return any.some((p) => session.permissions.includes(p));
}

/**
 * Any staff page: redirects to /login when not signed in, and says so on the login
 * page when the account is not on the staff list or its role allows nothing.
 */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaff();
  // Not on the staff list, or on it with a role that opens nothing: say so instead
  // of bouncing silently (or in a loop between pages it cannot open).
  if (!session || !homeFor(session.permissions)) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    redirect(user ? `/login?reason=not_staff&who=${encodeURIComponent(user.email ?? "")}` : "/login");
  }
  return session;
}

/** A page that needs one of these permissions; anyone else is sent to their own home page. */
export async function requirePermission(...any: Permission[]): Promise<StaffSession> {
  const session = await requireStaff();
  if (!can(session, ...any)) redirect(homeFor(session.permissions)!);
  return session;
}

/** For server actions: signed-in staff with any access at all. Throws instead of redirecting. */
export async function assertStaff(): Promise<StaffSession> {
  const session = await getStaff();
  if (!session) throw new Error("Not signed in");
  if (!session.permissions.length) throw new Error("Not allowed");
  return session;
}

/** For server actions: one of these permissions. Throws instead of redirecting. */
export async function assertPermission(...any: Permission[]): Promise<StaffSession> {
  const session = await getStaff();
  if (!session) throw new Error("Not signed in");
  if (!can(session, ...any)) throw new Error("Not allowed");
  return session;
}
