import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ALL_PERMISSIONS, cleanPermissions, legacyAccess, type Permission } from "@/lib/roles";
import type { RoleRow, StaffRow } from "@/lib/supabase/types";

/** One staff account as Settings > Users & roles lists it. */
export interface UserListRow {
  id: string;
  full_name: string;
  email: string | null;
  role_id: string | null;
  /** The role's name, or the old role for an account with no role_id. */
  role_name: string;
  permissions: Permission[];
  active: boolean;
  last_sign_in_at: string | null;
}

export interface RoleListRow {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  is_owner: boolean;
  /** Accounts on this role, active or not. */
  users: number;
}

export function rolePermissions(role: Pick<RoleRow, "is_owner" | "permissions">): Permission[] {
  return role.is_owner ? ALL_PERMISSIONS : cleanPermissions(role.permissions ?? []);
}

/** What an account can do now: its role, or the old role columns while it has none. */
export function staffPermissions(staff: StaffRow, roles: RoleRow[]): { name: string; owner: boolean; permissions: Permission[] } {
  const role = staff.role_id ? roles.find((r) => r.id === staff.role_id) : undefined;
  if (role) return { name: role.name, owner: role.is_owner, permissions: rolePermissions(role) };
  return legacyAccess(staff);
}

/** Every Supabase Auth user (1000 a page). Staff lists are small, so this stays one or two calls. */
export async function listAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

/** Everything the Users & roles tab shows. `missing` while the roles migration has not been run. */
export async function loadUsersAndRoles(admin: SupabaseClient): Promise<{ users: UserListRow[]; roles: RoleListRow[]; missing: boolean }> {
  const [rolesRes, staffRes, authUsers] = await Promise.all([
    admin.from("roles").select("*").order("sort_order").order("name"),
    admin.from("staff").select("*").order("full_name"),
    listAuthUsers(admin),
  ]);
  if (rolesRes.error) return { users: [], roles: [], missing: true };
  const roles = (rolesRes.data ?? []) as RoleRow[];
  const staff = (staffRes.data ?? []) as StaffRow[];
  const auth = new Map(authUsers.map((u) => [u.id, u]));

  return {
    missing: false,
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: rolePermissions(r),
      is_owner: r.is_owner,
      users: staff.filter((s) => s.role_id === r.id).length,
    })),
    users: staff.map((s) => {
      const access = staffPermissions(s, roles);
      const u = auth.get(s.id);
      return {
        id: s.id,
        full_name: s.full_name,
        email: u?.email ?? null,
        role_id: s.role_id,
        role_name: access.name,
        permissions: access.permissions,
        active: s.active,
        last_sign_in_at: u?.last_sign_in_at ?? null,
      };
    }),
  };
}
