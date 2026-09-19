import { requireStaff } from "@/lib/auth";
import { getEmailSettings } from "@/lib/settings";
import { EmailSettingsForm } from "@/components/EmailSettingsForm";
import { SalesScheduleForm } from "@/components/SalesScheduleForm";
import { getActiveEvent, getTicketTypes, publicOrder } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireStaff("admin");
  const s = await getEmailSettings();
  const event = await getActiveEvent();
  const types = event ? publicOrder(await getTicketTypes(event.id, { onlineOnly: true })) : [];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-zinc-500">Sales schedule and outbound email for tickets, receipts, and notices.</p>
      </div>
      <SalesScheduleForm types={types} />
      <EmailSettingsForm
        defaultEmail={session.email ?? ""}
        current={{
          provider: s.provider,
          source: s.source,
          smtp_host: s.smtp_host,
          smtp_port: s.smtp_port,
          smtp_user: s.smtp_user,
          smtp_secure: s.smtp_secure,
          has_smtp_pass: !!s.smtp_pass,
          has_resend_key: !!s.resend_api_key,
          from: s.from,
        }}
      />
    </div>
  );
}
