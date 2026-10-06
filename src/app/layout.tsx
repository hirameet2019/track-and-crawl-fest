import type { Metadata, Viewport } from "next";
import { Orbitron } from "next/font/google";
import { LOCALE } from "@/config/site";
import { SITE_URL, primaryChannel } from "@/config/event";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";
import { getRules } from "@/lib/rules";
import { RulesProvider } from "@/components/RulesProvider";
import { themeCss } from "@/lib/theme";
import "./globals.css";

const orbitron = Orbitron({ subsets: ["latin"], weight: ["700", "900"], variable: "--font-orbitron", display: "swap" });

/**
 * Title and description come from the active event row, so a new event names
 * itself the moment its row is set active. Pages give only their own label, e.g.
 * "Drifter wristbands", and the template appends the event name. The suffix and
 * share image come from Admin > Settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [event, site, rules] = await Promise.all([getActiveEvent(), getSiteSettings(), getRules()]);
  const name = event?.name ?? site.titleSuffix;
  const where = event?.venue ? ` at ${event.venue}` : "";
  const description = event ? `Buy tickets for ${event.name}${where}. Pay via ${primaryChannel(event, rules.channels).payVia}.` : undefined;
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: event ? [event.name, site.titleSuffix].filter(Boolean).join(" · ") : site.titleSuffix, template: `%s · ${name}` },
    description,
    openGraph: { title: name, description, images: [site.shareImage], locale: LOCALE.locale.replace("-", "_") },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const site = await getSiteSettings();
  return { width: "device-width", initialScale: 1, themeColor: site.theme.browserChrome };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [site, rules] = await Promise.all([getSiteSettings(), getRules()]);
  return (
    <html lang={LOCALE.locale.split("-")[0]} className={`${orbitron.variable} h-full antialiased`}>
      <head>
        {/* Brand palette from Admin > Settings, read by globals.css and the components. */}
        <style>{themeCss(site.theme)}</style>
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <RulesProvider rules={rules}>{children}</RulesProvider>
      </body>
    </html>
  );
}
