"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { downloadTicketCache, markKitClaimed, redeemTicket, type ScanResult } from "@/app/actions/scan";

type Cached = { token: string; number: string; type: string; holder: string | null; status: string };
const CACHE_KEY = "ticket-cache-v1";
const PENDING_KEY = "pending-redeems-v1";

function tokenFrom(raw: string) {
  const m = raw.match(/\/t\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : raw.trim();
}

// --- offline cache helpers (localStorage; wrapped because private mode can throw)
const readCache = (): Cached[] => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]"); } catch { return []; } };
const readPending = (): string[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]"); } catch { return []; } };
const readCacheAt = (): string | null => { try { return localStorage.getItem(CACHE_KEY + ":at"); } catch { return null; } };

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function Scanner() {
  const [result, setResult] = useState<AnyResult | null>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; at: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastRef = useRef<{ token: string; at: number } | null>(null);

  const refreshCache = useCallback(async () => {
    try {
      const list = await downloadTicketCache();
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      const at = new Date().toISOString();
      localStorage.setItem(CACHE_KEY + ":at", at);
      setCacheInfo({ count: list.length, at });
    } catch { /* offline */ }
  }, []);

  const syncPending = useCallback(async () => {
    const pending = readPending();
    if (!pending.length) return;
    const remaining: string[] = [];
    for (const tok of pending) {
      const r = await redeemTicket(tok).catch(() => null);
      if (!r || r.result === "error") remaining.push(tok);
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
    setPendingCount(remaining.length);
  }, []);

  // On mount: show what is already cached, then refresh and sync if online.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const at = readCacheAt();
      if (at) setCacheInfo({ count: readCache().length, at });
      setPendingCount(readPending().length);
      if (navigator.onLine) { refreshCache(); syncPending(); }
    });
    return () => { cancelled = true; };
  }, [refreshCache, syncPending]);

  // When connectivity returns, push queued redeems and refresh the cache.
  useEffect(() => {
    const onBackOnline = () => { syncPending(); refreshCache(); };
    window.addEventListener("online", onBackOnline);
    return () => window.removeEventListener("online", onBackOnline);
  }, [refreshCache, syncPending]);

  const offlineRedeem = useCallback((token: string) => {
    const cache = readCache();
    const c = cache.find((x) => x.token === token);
    if (!c) return setResult({ result: "offline_unknown" });
    const pend = readPending();
    if (c.status !== "issued" || pend.includes(token)) return setResult({ result: "offline_used", cached: c });
    pend.push(token);
    localStorage.setItem(PENDING_KEY, JSON.stringify(pend));
    setPendingCount(pend.length);
    setResult({ result: "offline_ok", cached: c });
  }, []);

  // --- handle a decoded QR value
  const handle = useCallback(async (raw: string) => {
    const token = tokenFrom(raw);
    const now = Date.now();
    if (lastRef.current && lastRef.current.token === token && now - lastRef.current.at < 4000) return;
    lastRef.current = { token, at: now };
    setBusy(true);
    if (navigator.onLine) {
      const r = await redeemTicket(token).catch((): ScanResult => ({ result: "error", message: "Network error" }));
      if (r.result === "error") offlineRedeem(token);
      else setResult(r);
    } else {
      offlineRedeem(token);
    }
    setBusy(false);
    if (navigator.vibrate) navigator.vibrate(80);
  }, [offlineRedeem]);

  // --- camera
  useEffect(() => {
    let cancelled = false;
    let started = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const s = new Html5Qrcode("qr-reader", { verbose: false });
        scannerRef.current = s;
        await s.start({ facingMode: "environment" }, { fps: 8, qrbox: { width: 240, height: 240 } }, (text) => handle(text), () => {});
        started = true;
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "Camera unavailable. Type the ticket link or token below.");
      }
    })();
    return () => {
      cancelled = true;
      // Only stop a scanner that actually started; stop() throws synchronously otherwise.
      if (!started) return;
      try {
        scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => {});
      } catch {
        /* already stopped */
      }
    };
  }, [handle]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className={online ? "text-emerald-700" : "font-semibold text-red-600"}>{online ? "Online" : "Offline: validating from cache"}</span>
        <span>{cacheInfo ? `${cacheInfo.count} tickets cached` : "No cache yet"}{pendingCount ? ` · ${pendingCount} to sync` : ""} <button onClick={refreshCache} className="underline">refresh</button></span>
      </div>

      <div id="qr-reader" className="overflow-hidden rounded-xl bg-black [&_video]:!w-full" />
      {cameraError && <p className="text-xs text-amber-700">{cameraError}</p>}

      <form onSubmit={(e) => { e.preventDefault(); if (manual) { handle(manual); setManual(""); } }} className="flex gap-2">
        <input className="input" placeholder="Or paste ticket link / token" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn-primary" disabled={busy}>Check</button>
      </form>

      {result && <ResultCard r={result} onKit={(id, item, v) => markKitClaimed(id, item, v).then((kit) => setResult((prev) => prev && "ticket" in prev ? { ...prev, ticket: { ...prev.ticket, kit_claimed: kit } } : prev))} />}
    </div>
  );
}

type AnyResult = ScanResult | { result: "offline_ok" | "offline_used" | "offline_unknown"; cached?: Cached };

function ResultCard({ r, onKit }: { r: AnyResult; onKit: (id: string, item: string, v: boolean) => void }) {
  const tone =
    r.result === "ok" || r.result === "offline_ok" ? "bg-emerald-600" :
    r.result === "already_redeemed" || r.result === "offline_used" ? "bg-red-600" :
    r.result === "void" ? "bg-zinc-800" : "bg-amber-500";
  const title =
    r.result === "ok" ? "ADMIT" :
    r.result === "offline_ok" ? "ADMIT (offline)" :
    r.result === "already_redeemed" ? "ALREADY USED" :
    r.result === "offline_used" ? "ALREADY USED (offline)" :
    r.result === "void" ? "VOID TICKET" :
    r.result === "not_found" || r.result === "offline_unknown" ? "NOT A VALID TICKET" : "ERROR";

  if ("cached" in r && r.cached) {
    return (
      <div className={`rounded-xl p-5 text-white ${tone}`}>
        <div className="text-2xl font-black">{title}</div>
        <div className="mt-2 text-3xl font-black">{r.cached.number}</div>
        <div>{r.cached.type}</div>
        <div className="text-sm opacity-90">{r.cached.holder}</div>
        <p className="mt-2 text-xs opacity-80">Will sync to the server when back online.</p>
      </div>
    );
  }
  if (!("ticket" in r)) {
    return (
      <div className={`rounded-xl p-5 text-white ${tone}`}>
        <div className="text-2xl font-black">{title}</div>
        {"message" in r && r.message && <p className="text-sm opacity-90">{r.message}</p>}
      </div>
    );
  }
  const t = r.ticket;
  const kit: { key: string; label: string; show: boolean }[] = [
    // Passengers bundled with a VIP Car Display package get no shirt: the package has one, for the driver.
    { key: "shirt", label: `T-shirt ${t.shirt_size ?? ""}`, show: t.ticket_type.includes_shirt && !t.included },
    { key: "lanyard", label: "ID lanyard", show: t.ticket_type.includes_lanyard },
    { key: "sticker", label: t.ticket_type.includes_car_pass && !t.companion_of ? "Event decals (2)" : "Event decal", show: t.ticket_type.includes_sticker },
    { key: "car_pass", label: "Car pass", show: t.ticket_type.includes_car_pass && !t.companion_of },
  ];
  return (
    <div className={`rounded-xl p-5 text-white ${tone}`}>
      <div className="flex items-start justify-between">
        <div className="text-2xl font-black">{title}</div>
        {r.result === "already_redeemed" && t.redeemed_at && <div className="text-right text-xs">first scan<br />{new Date(t.redeemed_at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}</div>}
      </div>
      <div className="mt-3 text-4xl font-black tracking-wide">{t.number}</div>
      <div className="text-lg font-semibold">{t.ticket_type.name}{t.ticket_type.band_color ? ` · ${t.ticket_type.band_color} band` : ""}</div>
      <div className="mt-1 text-sm">{t.holder_name} &middot; Order #{t.order.order_no}</div>
      {t.vehicle_plate && <div className="text-sm">Vehicle: {t.vehicle_plate} {t.vehicle_model}</div>}
      {t.companion_of && <div className="mt-1 inline-block rounded bg-black/25 px-2 py-0.5 text-sm font-semibold">Companion of car {t.companion_of}</div>}
      {t.vehicle_photo_url && (
        <a href={t.vehicle_photo_url} target="_blank" rel="noreferrer" className="mt-2 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.vehicle_photo_url} alt={`Car ${t.vehicle_plate ?? ""}`} className="max-h-40 rounded-lg border border-white/30 object-cover" />
          <div className="mt-1 text-[11px] opacity-80">Check that this is the car being brought in.</div>
        </a>
      )}
      {kit.some((k) => k.show) && (
        <div className="mt-4 space-y-1 rounded-lg bg-black/20 p-3">
          <div className="text-xs font-semibold uppercase opacity-80">Hand over</div>
          {kit.filter((k) => k.show).map((k) => (
            <label key={k.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={!!t.kit_claimed?.[k.key]} onChange={(e) => onKit(t.id, k.key, e.target.checked)} />
              {k.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
