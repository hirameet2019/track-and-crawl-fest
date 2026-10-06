import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings";
import { getActiveEvent } from "@/lib/queries";

export default async function NotFound() {
  const [event, site] = await Promise.all([getActiveEvent(), getSiteSettings()]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-brand px-6 py-20 text-center text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={site.logo} alt={event?.name ?? ""} className="mb-6 w-56 opacity-90" />
      <h1 className="text-2xl font-black uppercase italic">This page does not exist</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-400">
        The link may be incomplete or mistyped. If you are looking for your order, open the link from your email, or go back to the tickets page.
        <br />
        <span className="text-zinc-500">Maaaring kulang o mali ang link. Buksan ang link mula sa email mo, o bumalik sa tickets page.</span>
      </p>
      <Link href="/" className="btn-neon mt-6">Back to tickets</Link>
    </main>
  );
}
