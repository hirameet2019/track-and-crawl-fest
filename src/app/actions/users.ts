"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertPermission, type StaffSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getRules } from "@/lib/rules";
import { cleanPermissions, type Permission } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RoleRow, StaffRow } from "@/lib/supabase/types";
import { listAuthUsers, rolePermissions, staffPermissions } from "@/lib/users";
import type { ActionResult } from "./orders";

/*
 * Settings > Users & roles. Everything here needs the "users" permission, and on
 * top of that nobody can hand out more than they have:
 *   - a role can only be given, created or edited with permissions the editor holds
 *   - an account whose role has more than the editor cannot be changed by them
 *   - nobody changes their own role or turns off their own account
 *   - the last active System admin (owner role) stays, so Settings is never locked
 * A System admin passes the first two everywhere.
 */

const PASSWORD_MIN = 8;

const nameSchema = z.string().trim().min(2, "Enter the person's name").max(80);
const passwordSchema = z.string().min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters`).max(72);

function covers(session: StaffSession, perms: readonly Permission[]): boolean {
  return session.role.owner || perms.every((p) => session.permissions.includes(p));
}

const TOO_MUCH = "That role has permissions you do not have. Ask a System admin.";

async function loadRoles(admin: SupabaseClient): Promise<RoleRow[]> {
  const { data, error } = await admin.from("roles").select("*");
  if (error) throw new Error("Run the roles migration first (supabase/migrations/20261028010000_roles_permissions.sql).");
  return (data ?? []) as RoleRow[];
}

/** Active accounts on the owner role (or, before the migration, admins with system access). */
async function activeOwnerIds(admin: SupabaseClient, roles: RoleRow[]): Promise<string[]> {
  const { data } = await admin.from("staff").select("*").eq("active", true);
  return ((data ?? []) as StaffRow[]).filter((s) => staffPermissions(s, roles).owner).map((s) => s.id);
}

/** "walkin1" becomes walkin1@<staff login domain>; a full email stays as it is. */
async function loginToEmail(login: string): Promise<string | null> {
  const id = login.trim().toLowerCase();
  if (!id) return null;
  const email = id.includes("@") ? id : `${id}@${(await getRules()).staffUsernameDomain}`;
  return z.string().email().safeParse(email).success ? email : null;
}

const createSchema = z.object({
  full_name: nameSchema,
  login: z.string().trim().min(1, "Enter a username or email").max(120),
  password: passwordSchema,
  role_id: z.string().uuid("Pick a role"),
});

export async function createStaffUser(input: z.input<typeof createSchema>): Promise<ActionResult & { linked?: boolean }> {
  try {
    const session = await assertPermission("users");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const v = parsed.data;
    const email = await loginToEmail(v.login);
    if (!email) return { ok: false, error: "That username or email looks wrong" };

    const admin = createAdminClient();
    const role = (await loadRoles(admin)).find((r) => r.id === v.role_id);
    if (!role) return { ok: false, error: "That role no longer exists" };
    if (!covers(session, rolePermissions(role))) return { ok: false, error: TOO_MUCH };

    // A login that already exists in Supabase Auth (an old account, or one made by
    // hand) is put on the staff list with the new password instead of failing.
    let userId: string;
    let linked = false;
    const created = await admin.auth.admin.createUser({ email, password: v.password, email_confirm: true, user_metadata: { full_name: v.full_name } });
    if (created.data.user) {
      userId = created.data.user.id;
    } else {
      const existing = (await listAuthUsers(admin)).find((u) => u.email?.toLowerCase() === email);
      if (!existing) return { ok: false, error: created.error?.message ?? "Could not create the login" };
      const { data: onList } = await admin.from("staff").select("id, active").eq("id", existing.id).maybeSingle();
      if (onList) return { ok: false, error: onList.active ? `${email} is already on the staff list` : `${email} is already on the staff list, turned off. Edit it below and turn it back on.` };
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password: v.password, email_confirm: true });
      if (error) return { ok: false, error: error.message };
      userId = existing.id;
      linked = true;
    }

    const { error } = await admin.from("staff").insert({ id: userId, full_name: v.full_name, role_id: role.id, active: true });
    if (error) return { ok: false, error: error.message };
    await audit(admin, { actor: session.userId, action: "staff.created", entity: "staff", entity_id: userId, data: { name: v.full_name, login: email, role: role.name, linked } });
    revalidatePath("/admin/settings");
    return { ok: true, linked };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

const updateSchema = z.object({
  id: z.string().uuid(),
  full_name: nameSchema,
  role_id: z.string().uuid("Pick a role"),
  active: z.boolean(),
});

export async function updateStaffUser(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  try {
    const session = await assertPermission("users");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const v = parsed.data;

    const admin = createAdminClient();
    const roles = await loadRoles(admin);
    const { data: target } = await admin.from("staff").select("*").eq("id", v.id).maybeSingle<StaffRow>();
    if (!target) return { ok: false, error: "That account is no longer on the staff list" };
    const role = roles.find((r) => r.id === v.role_id);
    if (!role) return { ok: false, error: "That role no longer exists" };

    const before = staffPermissions(target, roles);
    const roleChanged = target.role_id !== role.id;
    if (v.id === session.userId && (roleChanged || !v.active)) return { ok: false, error: "You cannot change your own role or turn off your own account. Ask another admin." };
    if (!covers(session, before.permissions)) return { ok: false, error: "This account has permissions you do not have. Ask a System admin." };
    if (roleChanged && !covers(session, rolePermissions(role))) return { ok: false, error: TOO_MUCH };
    if (before.owner && target.active && (!role.is_owner || !v.active)) {
      const owners = await activeOwnerIds(admin, roles);
      if (owners.length <= 1) return { ok: false, error: "This is the only active System admin. Give another account that role first." };
    }

    const { error } = await admin.from("staff").update({ full_name: v.full_name, role_id: role.id, active: v.active }).eq("id", v.id);
    if (error) return { ok: false, error: error.message };
    await audit(admin, {
      actor: session.userId, action: "staff.updated", entity: "staff", entity_id: v.id,
      data: { name: v.full_name, role: role.name, previous_role: before.name, active: v.active, was_active: target.active },
    });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function setStaffPassword(id: string, password: string): Promise<ActionResult> {
  try {
    const session = await assertPermission("users");
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return { ok: false, error: pw.error.issues[0]?.message ?? "Invalid password" };

    const admin = createAdminClient();
    const roles = await loadRoles(admin);
    const { data: target } = await admin.from("staff").select("*").eq("id", id).maybeSingle<StaffRow>();
    if (!target) return { ok: false, error: "That account is no longer on the staff list" };
    if (id !== session.userId && !covers(session, staffPermissions(target, roles).permissions)) {
      return { ok: false, error: "This account has permissions you do not have. Ask a System admin." };
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password: pw.data });
    if (error) return { ok: false, error: error.message };
    await audit(admin, { actor: session.userId, action: "staff.password_set", entity: "staff", entity_id: id, data: { name: target.full_name } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

const roleSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(2, "Give the role a name").max(40),
  description: z.string().trim().max(200),
  permissions: z.array(z.string()).max(50),
});

export async function saveRole(input: z.input<typeof roleSchema>): Promise<ActionResult & { id?: string }> {
  try {
    const session = await assertPermission("users");
    const parsed = roleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const v = parsed.data;
    const permissions = cleanPermissions(v.permissions);
    if (!covers(session, permissions)) return { ok: false, error: "You can only give a role permissions you have yourself." };

    const admin = createAdminClient();
    const roles = await loadRoles(admin);
    const clash = roles.find((r) => r.name.toLowerCase() === v.name.toLowerCase() && r.id !== v.id);
    if (clash) return { ok: false, error: `There is already a role called ${clash.name}` };
    const row = { name: v.name, description: v.description || null, permissions };

    if (v.id) {
      const role = roles.find((r) => r.id === v.id);
      if (!role) return { ok: false, error: "That role no longer exists" };
      if (role.is_owner) return { ok: false, error: "The System admin role always has every permission and cannot be changed." };
      if (!session.role.owner && session.role.id === role.id) return { ok: false, error: "You cannot edit your own role. Ask a System admin." };
      if (!covers(session, rolePermissions(role))) return { ok: false, error: TOO_MUCH };
      const { error } = await admin.from("roles").update(row).eq("id", role.id);
      if (error) return { ok: false, error: error.message };
      await audit(admin, { actor: session.userId, action: "role.updated", entity: "role", entity_id: role.id, data: { ...row, previous_name: role.name, previous_permissions: rolePermissions(role) } });
      revalidatePath("/admin", "layout");
      return { ok: true, id: role.id };
    }

    const sort = Math.max(0, ...roles.map((r) => r.sort_order)) + 10;
    const { data, error } = await admin.from("roles").insert({ ...row, sort_order: sort }).select("id").single();
    if (error) return { ok: false, error: error.message };
    await audit(admin, { actor: session.userId, action: "role.created", entity: "role", entity_id: data.id, data: row });
    revalidatePath("/admin/settings");
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function deleteRole(id: string): Promise<ActionResult> {
  try {
    const session = await assertPermission("users");
    const admin = createAdminClient();
    const role = (await loadRoles(admin)).find((r) => r.id === id);
    if (!role) return { ok: false, error: "That role no longer exists" };
    if (role.is_owner) return { ok: false, error: "The System admin role cannot be deleted." };
    if (!covers(session, rolePermissions(role))) return { ok: false, error: TOO_MUCH };
    const { count } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("role_id", id);
    if (count) return { ok: false, error: `${count} account${count === 1 ? " still has" : "s still have"} this role. Move ${count === 1 ? "it" : "them"} to another role first.` };

    const { error } = await admin.from("roles").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit(admin, { actor: session.userId, action: "role.deleted", entity: "role", entity_id: id, data: { name: role.name, permissions: rolePermissions(role) } });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
