import { requireStaff } from "@/lib/auth";
import { StaffNav } from "@/components/StaffNav";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff("scanner");
  return (
    <div className="dark-zone staff-shell relative isolate flex min-h-full flex-1 flex-col bg-[#0a0a0c] text-zinc-100">
      {/* faint brand glow behind the whole staff area */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(900px_300px_at_10%_0%,rgba(255,63,209,0.16),transparent_60%),radial-gradient(800px_300px_at_90%_0%,rgba(47,216,255,0.14),transparent_60%)]" aria-hidden />
      <StaffNav name={session.staff.full_name} role={session.staff.role} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
