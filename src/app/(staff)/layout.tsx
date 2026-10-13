import { requireStaff } from "@/lib/auth";
import { StaffNav } from "@/components/StaffNav";
import { getActiveEvent, hasDrifterLabel } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";
import { neon } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff("scanner");
  const [event, site] = await Promise.all([getActiveEvent(), getSiteSettings()]);
  // The Drifters tab only makes sense for an event that sells drifter family bands.
  const drifters = event ? await hasDrifterLabel(event.id) : false;
  return (
    <div className="dark-zone staff-shell relative isolate flex min-h-full flex-1 flex-col bg-brand text-zinc-100">
      {/* faint brand glow behind the whole staff area */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{
          backgroundImage: [
            `radial-gradient(900px 300px at 10% 0%, ${neon("pink", 0.16)}, transparent 60%)`,
            `radial-gradient(800px 300px at 90% 0%, ${neon("cyan", 0.14)}, transparent 60%)`,
          ].join(", "),
        }}
        aria-hidden
      />
      <StaffNav name={session.staff.full_name} role={session.staff.role} system={!!session.staff.system_access} eventName={event?.name ?? ""} drifters={drifters} logo={site.logo} backdrop={site.backdrop} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
