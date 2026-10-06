"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordSignIn } from "@/app/actions/auth";
import { PasswordInput } from "@/components/PasswordInput";
import { useRules } from "@/components/RulesProvider";

export function LoginForm({ next, signedOutFirst = false }: { next?: string; signedOutFirst?: boolean }) {
  const domain = useRules().staffUsernameDomain;
  const router = useRouter();
  // A user who is authenticated but not on the staff list keeps a valid session cookie;
  // clear it so the next attempt (possibly with another account) starts clean.
  useEffect(() => {
    if (signedOutFirst) createClient().auth.signOut().catch(() => {});
  }, [signedOutFirst]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Gate staff get short usernames (e.g. "walkin1"); the account behind it is username@<domain from Settings>.
    const id = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: id.includes("@") ? id : `${id}@${domain}`, password });
    setBusy(false);
    if (error) return setError(error.message);
    await recordSignIn().catch(() => {});
    router.replace(next && next.startsWith("/") ? next : "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className="label">Username or email</label>
        <input className="input" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" placeholder="e.g. walkin1" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label">Password</label>
        <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      <p className="text-xs text-zinc-500">Accounts are created by the administrator in Supabase Auth and added to the staff table.</p>
    </form>
  );
}
