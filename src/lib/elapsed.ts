/**
 * A waiting time a verifier can read at a glance: "45 min", "20h 55m", "2d 3h".
 * Raw minutes stop being readable after an hour or so ("1255 min" is 20h 55m).
 */
export function humanMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
