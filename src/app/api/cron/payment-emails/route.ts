import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrderBundle } from "@/lib/queries";
import { sendExpiryNoticeEmail, sendPaymentReminderEmail } from "@/lib/email";
import { EXPIRY_NOTICE_MAX_AGE_HOURS, REMINDER_MINUTES_BEFORE_EXPIRY } from "@/config/event";

export const dynamic = "force-dynamic";

/**
 * Two nudges around the payment window, driven by Vercel Cron (see vercel.json):
 *
 *   reminder      pending_payment, a few minutes left  -> "hurry, here is the link"
 *   expiry notice the hold has just lapsed             -> "cancelled; do not pay twice"
 *
 * Each order is stamped the moment its mail goes out, so overlapping or retried
 * cron runs cannot mail the same buyer twice. Sends are capped per run because
 * the function has a 30s budget and SMTP is the slow part.
 */
const MAX_PER_RUN = 20;

/** Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. Without the secret set, refuse. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Flip anything past its deadline first, so the two queries below see a settled
  // state and an order cannot be picked up as both "expiring" and "expired".
  await admin.rpc("expire_stale_orders", {});

  const now = Date.now();
  const reminderCutoff = new Date(now + REMINDER_MINUTES_BEFORE_EXPIRY * 60_000).toISOString();
  const noticeFloor = new Date(now - EXPIRY_NOTICE_MAX_AGE_HOURS * 3_600_000).toISOString();

  const [{ data: expiringSoon }, { data: justExpired }] = await Promise.all([
    admin
      .from("orders")
      .select("id, expires_at")
      .eq("status", "pending_payment")
      .is("reminder_sent_at", null)
      .not("buyer_email", "is", null)
      .gt("expires_at", new Date(now).toISOString())
      .lte("expires_at", reminderCutoff)
      .limit(MAX_PER_RUN),
    admin
      .from("orders")
      .select("id, expires_at")
      .eq("status", "expired")
      .is("expiry_notice_sent_at", null)
      .not("buyer_email", "is", null)
      // Only for a hold that lapsed recently, so a paused cron cannot cause a
      // burst of late notices about orders the buyer has already moved on from.
      .gt("expires_at", noticeFloor)
      .limit(MAX_PER_RUN),
  ]);

  const result = { reminders: 0, notices: 0, skipped: 0, failed: [] as string[] };

  /**
   * Sends one mail and stamps the order only if it really went out. A dry run
   * (no provider configured) and an order with no address both leave the stamp
   * null, so nothing is silently marked as delivered when it was not.
   */
  async function sweep(
    rows: { id: string; expires_at: string | null }[],
    stamp: "reminder_sent_at" | "expiry_notice_sent_at",
    sendOne: (b: NonNullable<Awaited<ReturnType<typeof getOrderBundle>>>, row: { expires_at: string | null }) => Promise<{ ok: boolean; dryRun?: boolean }>,
    counter: "reminders" | "notices",
  ) {
    for (const row of rows) {
      try {
        const bundle = await getOrderBundle(row.id);
        if (!bundle) { result.skipped++; continue; }
        const sent = await sendOne(bundle, row);
        if (!sent.ok || sent.dryRun) { result.skipped++; continue; }
        await admin.from("orders").update({ [stamp]: new Date().toISOString() }).eq("id", row.id);
        result[counter]++;
      } catch (e) {
        console.error(`[cron] ${stamp} failed for ${row.id}`, e);
        result.failed.push(row.id);
      }
    }
  }

  await sweep(expiringSoon ?? [], "reminder_sent_at", (bundle, row) => {
    const msLeft = row.expires_at ? new Date(row.expires_at).getTime() - Date.now() : 0;
    return sendPaymentReminderEmail(bundle, Math.max(1, Math.round(msLeft / 60_000)));
  }, "reminders");

  await sweep(justExpired ?? [], "expiry_notice_sent_at", (bundle) => sendExpiryNoticeEmail(bundle), "notices");

  return NextResponse.json({ ok: true, ...result });
}
