"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { sendTestEmail } from "@/lib/email";
import { clearEmailSettings, getEmailSettings, saveEmailSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "./orders";

const schema = z.object({
  smtp_host: z.string().trim().max(200),
  smtp_port: z.coerce.number().int().min(1).max(65535).default(587),
  smtp_user: z.string().trim().max(200),
  smtp_pass: z.string().max(500),
  smtp_secure: z.coerce.boolean().default(false),
  resend_api_key: z.string().trim().max(200),
  from: z.string().trim().max(200),
});

export async function saveEmailSettingsAction(formData: FormData): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const parsed = schema.safeParse({
      smtp_host: formData.get("smtp_host") ?? "",
      smtp_port: formData.get("smtp_port") || 587,
      smtp_user: formData.get("smtp_user") ?? "",
      smtp_pass: formData.get("smtp_pass") ?? "",
      smtp_secure: formData.get("smtp_secure") === "on",
      resend_api_key: formData.get("resend_api_key") ?? "",
      from: formData.get("from") ?? "",
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const v = parsed.data;

    // Blank password or API key means "keep the one already saved".
    const current = await getEmailSettings();
    if (!v.smtp_pass && current.source === "database") v.smtp_pass = current.smtp_pass;
    if (!v.resend_api_key && current.source === "database") v.resend_api_key = current.resend_api_key;

    if (v.smtp_host && !v.from) return { ok: false, error: "Enter the sender address (From)" };
    if (!v.smtp_host && !v.resend_api_key) {
      await clearEmailSettings();
    } else {
      await saveEmailSettings(v, userId);
    }
    await createAdminClient().from("audit_log").insert({ actor: userId, action: "settings.email_updated", entity: "app_settings", entity_id: "email", data: { provider: v.smtp_host ? "smtp" : v.resend_api_key ? "resend" : "none", smtp_host: v.smtp_host, smtp_user: v.smtp_user, from: v.from } });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function sendTestEmailAction(to: string): Promise<ActionResult> {
  try {
    await assertStaff("admin");
    const addr = z.string().trim().email().safeParse(to);
    if (!addr.success) return { ok: false, error: "Enter a valid email address" };
    const settings = await getEmailSettings();
    if (settings.provider === "dry-run") return { ok: false, error: "No provider configured. Save SMTP or Resend settings first." };
    const r = await sendTestEmail(addr.data, settings);
    return { ok: true, warning: `Sent via ${r.provider} (${settings.source}). Check the inbox, including spam.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}
