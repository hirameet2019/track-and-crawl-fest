"use client";

import { useSyncExternalStore } from "react";
import { useText } from "@/components/RulesProvider";

// Ticks once a second. Server snapshot is null so SSR renders a neutral
// placeholder and the client fills in the real value after hydration,
// which avoids a server/client text mismatch.
function subscribe(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
const getNow = () => Math.floor(Date.now() / 1000);
const getServerNow = () => null;

export function Countdown({ until }: { until: string }) {
  const nowSec = useSyncExternalStore(subscribe, getNow, getServerNow);
  const timeUp = useText()("pay.timeUp");
  if (nowSec === null) return <b>--:--</b>;
  const left = Math.floor(new Date(until).getTime() / 1000) - nowSec;
  if (left <= 0) return <b className="text-red-600">{timeUp}</b>;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return <b>{m}:{String(s).padStart(2, "0")}</b>;
}
