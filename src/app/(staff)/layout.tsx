import { requireStaff } from "@/lib/auth";
import { StaffShell } from "@/components/StaffShell";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  const [event, site] = await Promise.all([getActiveEvent(), getSiteSettings()]);
  return (
    <div className="staff-shell flex min-h-full flex-1 flex-col bg-brand text-zinc-900">
      <StaffShell name={session.staff.full_name} roleName={session.role.name} permissions={session.permissions} eventName={event?.name ?? ""} logo={site.logo}>
        {children}
      </StaffShell>
    </div>
  );
}
