import type { StaffRole } from "@/lib/supabase/types";

/**
 * Staff roles from least to most access. Each one sees everything below it.
 *   scanner  Scan only
 *   gate     the walk-in desk: Walk-in and Scan, nothing about online orders or buyers
 *   staff    + Dashboard, Verify, Orders, Drifters
 *   admin    + Numbers, Audit, Settings
 * A role this code does not know ranks 0 and gets nothing, so a new value added to
 * the database ahead of the code can never fall through to full access.
 */
const RANK: Record<StaffRole, number> = { scanner: 1, gate: 2, staff: 3, admin: 4 };

export function roleRank(role: string): number {
  return RANK[role as StaffRole] ?? 0;
}

export function hasRole(role: string, min: StaffRole): boolean {
  return roleRank(role) >= RANK[min];
}

/** Where a role lands after signing in, and when it opens a page above its role. */
export function homeFor(role: string): string {
  if (hasRole(role, "staff")) return "/admin";
  if (role === "gate") return "/admin/walkin";
  return "/scan";
}
