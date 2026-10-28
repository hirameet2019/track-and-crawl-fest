import type { StaffRow } from "@/lib/supabase/types";

/**
 * What a staff account may do. A role (table `roles`, edited in Settings > Users &
 * roles) is a named set of these keys; the owner role has all of them. A key this
 * code does not know is ignored, so a role saved ahead of the code grants nothing extra.
 */
export const PERMISSIONS = [
  { key: "dashboard", group: "Overview", label: "Dashboard", hint: "Sales totals and live orders." },
  { key: "verify", group: "Sales", label: "Verify payments", hint: "Approve or reject payment proofs." },
  { key: "orders", group: "Sales", label: "Orders", hint: "Orders and buyer details, cancel unpaid orders, re-send emails, export the list." },
  { key: "orders_manage", group: "Sales", label: "Void & convert", hint: "Void orders or single registrations, convert orders, settle balances, undo gate scans." },
  { key: "walkin", group: "Sales", label: "Walk-in", hint: "Record and undo gate sales." },
  { key: "walkin_prices", group: "Sales", label: "Walk-in prices", hint: "Change the gate price of a label." },
  { key: "scan", group: "Gate", label: "Scan", hint: "The gate scanner." },
  { key: "reports", group: "Admin", label: "Reports", hint: "Reports and the walk-in workbook per staff." },
  { key: "numbers", group: "Admin", label: "Numbers", hint: "Import, void and restore registration numbers." },
  { key: "audit", group: "Admin", label: "Audit", hint: "The audit trail and its export." },
  { key: "settings", group: "Admin", label: "Settings", hint: "Every Settings tab except Users & roles." },
  { key: "users", group: "Admin", label: "Users & roles", hint: "Add staff, reset passwords, assign and edit roles." },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

export function isPermission(key: string): key is Permission {
  return (ALL_PERMISSIONS as string[]).includes(key);
}

/** Known keys only, in PERMISSIONS order. */
export function cleanPermissions(keys: readonly string[]): Permission[] {
  return ALL_PERMISSIONS.filter((k) => keys.includes(k));
}

/**
 * An account with no role_id (added by SQL the old way, or before the roles
 * migration ran) keeps what its old rank gave it. Same sets as the built-in roles
 * in 20261028010000_roles_permissions.sql.
 */
const LEGACY: Record<string, Permission[]> = {
  scanner: ["scan"],
  gate: ["walkin", "scan"],
  staff: ["dashboard", "verify", "orders", "walkin", "scan"],
  admin: ["dashboard", "verify", "orders", "orders_manage", "walkin", "walkin_prices", "scan", "reports"],
};

export function legacyAccess(staff: Pick<StaffRow, "role" | "system_access" | "can_scan">): { name: string; owner: boolean; permissions: Permission[] } {
  if (staff.role === "admin" && staff.system_access) return { name: "System admin", owner: true, permissions: ALL_PERMISSIONS };
  const permissions = (LEGACY[staff.role] ?? []).filter((p) => p !== "scan" || staff.can_scan !== false);
  const name = staff.role.charAt(0).toUpperCase() + staff.role.slice(1);
  return { name, owner: false, permissions };
}

/** Pages in the order a signed-in account looks for its home. */
const PAGES: { href: string; any: Permission[] }[] = [
  { href: "/admin", any: ["dashboard"] },
  { href: "/admin/verify", any: ["verify"] },
  { href: "/admin/orders", any: ["orders"] },
  { href: "/admin/walkin", any: ["walkin"] },
  { href: "/scan", any: ["scan"] },
  { href: "/admin/reports", any: ["reports"] },
  { href: "/admin/numbers", any: ["numbers"] },
  { href: "/admin/audit", any: ["audit"] },
  { href: "/admin/settings", any: ["settings", "users"] },
];

/** Where an account lands after signing in, and when it opens a page it may not see. Null: nowhere. */
export function homeFor(permissions: readonly Permission[]): string | null {
  return PAGES.find((p) => p.any.some((k) => permissions.includes(k)))?.href ?? null;
}
