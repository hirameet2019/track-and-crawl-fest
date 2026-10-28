import { getRules } from "@/lib/rules";
import { siteText } from "@/lib/site-text";
import type { EventRow } from "@/lib/supabase/types";

/**
 * "Need help?" box for buyers who get stuck (paid but timer ran out, wrong email,
 * no ticket email). Renders nothing until the organizer sets a contact on the
 * events row (support_contact_label + support_contact_url). Wording from
 * Settings > Website text.
 */
export async function SupportContact({ event, compact = false }: { event: Pick<EventRow, "support_contact_label" | "support_contact_url">; compact?: boolean }) {
  if (!event.support_contact_url || !event.support_contact_label) return null;
  const t = siteText((await getRules()).text);
  const isLink = /^https?:/i.test(event.support_contact_url);
  if (compact) {
    return (
      <p className="text-xs text-zinc-500">
        {t("help.compact")}{" "}
        <a href={event.support_contact_url} target={isLink ? "_blank" : undefined} rel="noreferrer" className="font-semibold underline">
          {event.support_contact_label}
        </a>
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <div>
        <div className="font-semibold">{t("help.title")}</div>
        {t("help.text") && <div className="text-xs text-sky-900/80">{t("help.text")}</div>}
      </div>
      <a href={event.support_contact_url} target={isLink ? "_blank" : undefined} rel="noreferrer" className="btn-primary whitespace-nowrap">
        {event.support_contact_label}
      </a>
    </div>
  );
}
