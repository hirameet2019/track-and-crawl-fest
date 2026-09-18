import { createAdminClient } from "@/lib/supabase/admin";

export interface EmailSettings {
  provider: "smtp" | "resend" | "dry-run";
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_secure: boolean;
  resend_api_key: string;
  from: string;
  /** Where the effective values came from. */
  source: "database" | "environment" | "none";
}

const KEY = "email";

function fromEnv(): Omit<EmailSettings, "provider" | "source"> {
  return {
    smtp_host: process.env.SMTP_HOST ?? "",
    smtp_port: Number(process.env.SMTP_PORT ?? 587),
    smtp_user: process.env.SMTP_USER ?? "",
    smtp_pass: process.env.SMTP_PASS ?? "",
    smtp_secure: process.env.SMTP_SECURE === "true",
    resend_api_key: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "",
  };
}

function withProvider(v: Omit<EmailSettings, "provider" | "source">, source: EmailSettings["source"]): EmailSettings {
  const provider: EmailSettings["provider"] = v.smtp_host ? "smtp" : v.resend_api_key ? "resend" : "dry-run";
  return { ...v, provider, source: provider === "dry-run" ? "none" : source };
}

/**
 * Effective email settings: the row saved from Admin > Settings wins; otherwise
 * the environment variables; otherwise dry-run.
 */
export async function getEmailSettings(): Promise<EmailSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  const db = data?.value as Partial<Omit<EmailSettings, "provider" | "source">> | undefined;
  if (db && (db.smtp_host || db.resend_api_key)) {
    return withProvider(
      {
        smtp_host: db.smtp_host ?? "",
        smtp_port: Number(db.smtp_port ?? 587),
        smtp_user: db.smtp_user ?? "",
        smtp_pass: db.smtp_pass ?? "",
        smtp_secure: !!db.smtp_secure,
        resend_api_key: db.resend_api_key ?? "",
        from: db.from ?? "",
      },
      "database",
    );
  }
  return withProvider(fromEnv(), "environment");
}

export async function saveEmailSettings(
  value: Omit<EmailSettings, "provider" | "source">,
  actorId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function clearEmailSettings(): Promise<void> {
  const admin = createAdminClient();
  await admin.from("app_settings").delete().eq("key", KEY);
}
