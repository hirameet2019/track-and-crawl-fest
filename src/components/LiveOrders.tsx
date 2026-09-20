"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a staff page current without polling. One Realtime channel per open tab;
 * the database broadcasts a small message whenever an order is inserted or
 * updated, and the page is re-rendered (router.refresh) once, debounced, so a
 * burst of changes costs one request. Nothing is fetched while nothing happens.
 *
 * A soft chime plays when an order lands in the verification queue, so the
 * verifier can look away from the screen. The mute choice is remembered per device.
 */
type OrderChange = { id: string; order_no: number; status: string; old_status: string | null; op: "INSERT" | "UPDATE" };
const MUTE_KEY = "drift.live.muted";

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [freq, at] of [[880, 0], [1175, 0.12]] as [number, number][]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.4);
    }
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    /* audio is a nicety; never break the page over it */
  }
}

export function LiveOrders({ watch = "all" }: { watch?: "all" | "verification" }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    // Read the remembered mute choice after mount (localStorage is per device and may throw in private mode).
    const id = setTimeout(() => {
      try { const m = localStorage.getItem(MUTE_KEY) === "1"; mutedRef.current = m; setMuted(m); } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    // The database broadcasts one small message per order insert/update on the private
    // topic "orders" (trigger notify_order_change). Joining needs the staff session token;
    // RLS on realtime.messages turns everyone else away.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel("orders", { config: { private: true } })
        .on("broadcast", { event: "order_changed" }, (msg) => {
          const row = msg.payload as OrderChange;
          if (row.op === "INSERT") {
            if (watch === "all") { setToast(`New order #${row.order_no} placed`); refresh(); }
            return;
          }
          if (row.status === "awaiting_verification" && row.old_status !== "awaiting_verification") {
            setToast(`Order #${row.order_no} is ready for verification`);
            if (!mutedRef.current) chime();
          }
          refresh();
        })
        .subscribe((status) => {
          setState(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
        });
    })();
    // Keep the socket authorised when the session token rotates.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, watch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
          state === "live" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : state === "connecting" ? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300" : "border-amber-400/40 bg-amber-400/10 text-amber-300"
        }`}
        title={state === "live" ? "Updates arrive automatically; no need to refresh" : state === "connecting" ? "Connecting to live updates" : "Live updates disconnected; refresh the page"}
      >
        <span className={`h-2 w-2 rounded-full ${state === "live" ? "animate-pulse bg-emerald-400" : state === "connecting" ? "bg-zinc-400" : "bg-amber-400"}`} aria-hidden />
        {state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline"}
      </span>
      <button type="button" onClick={toggleMute} className="rounded-full border border-white/15 px-2.5 py-1 text-zinc-300 hover:bg-white/10" title={muted ? "Sound off for new orders" : "Sound on for new orders"} aria-pressed={muted}>
        {muted ? "Sound off" : "Sound on"}
      </button>
      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 rounded-xl border border-cyan-300/40 bg-zinc-900/95 px-4 py-3 text-sm text-white shadow-2xl">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-cyan-300 align-middle" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
