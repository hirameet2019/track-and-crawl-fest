import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { LOCALE } from "@/config/site";
import { SITE_URL, primaryChannel } from "@/config/event";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";
import { getRules } from "@/lib/rules";
import { RulesProvider } from "@/components/RulesProvider";
import { themeCss } from "@/lib/theme";
import "./globals.css";

// Display: a heavy condensed italic, the poster's "TARLAC CIRCUIT HILL / NOV 7" voice.
// Body: its plain sibling, so the two read as one family.
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800", "900"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });

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
  const description = event ? `Buy tickets for ${event.name}${where}. Pay via ${primaryChannel(event, rules.channels, rules.extraChannels).payVia}.` : undefined;
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
    <html lang={LOCALE.locale.split("-")[0]} className={`${display.variable} ${body.variable} h-full antialiased`}>
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
