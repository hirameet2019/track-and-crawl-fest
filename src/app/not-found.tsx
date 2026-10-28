import Link from "next/link";
import { SiteLogo } from "@/components/SiteLogo";
import { getSiteSettings } from "@/lib/site-settings";
import { getActiveEvent } from "@/lib/queries";
import { getRules } from "@/lib/rules";
import { siteText } from "@/lib/site-text";

export default async function NotFound() {
  const [event, site, rules] = await Promise.all([getActiveEvent(), getSiteSettings(), getRules()]);
  const tx = siteText(rules.text);
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-brand px-6 py-20 text-center text-white">
      <SiteLogo src={site.logo} name={event?.name ?? ""} size="md" className="mb-6 w-56 opacity-90" />
      <h1 className="text-2xl font-black uppercase italic">{tx("notFound.title")}</h1>
      {(tx("notFound.text") || tx("notFound.textTl")) && (
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          {tx("notFound.text")}
          {tx("notFound.text") && tx("notFound.textTl") && <br />}
          {tx("notFound.textTl") && <span className="text-zinc-500">{tx("notFound.textTl")}</span>}
        </p>
      )}
      <Link href="/" className="btn-neon mt-6">{tx("notFound.button")}</Link>
    </main>
  );
}
