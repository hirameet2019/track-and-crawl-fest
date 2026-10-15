import { requireStaff } from "@/lib/auth";
import { StaffShell } from "@/components/StaffShell";
import { getActiveEvent, hasDrifterLabel } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff("scanner");
  const [event, site] = await Promise.all([getActiveEvent(), getSiteSettings()]);
  // The Drifters tab only makes sense for an event that sells drifter family bands.
  const drifters = event ? await hasDrifterLabel(event.id) : false;
  return (
    <div className="staff-shell flex min-h-full flex-1 flex-col bg-brand text-zinc-900">
      <StaffShell name={session.staff.full_name} role={session.staff.role} system={!!session.staff.system_access} scan={session.staff.can_scan !== false} eventName={event?.name ?? ""} drifters={drifters} logo={site.logo}>
        {children}
      </StaffShell>
    </div>
  );
}
