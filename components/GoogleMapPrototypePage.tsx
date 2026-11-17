import { connection } from "next/server";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import MapDiscovery from "@/components/MapDiscovery";
import MaterialIcon from "@/components/MaterialIcon";
import { getPublishedRestaurants } from "@/lib/db/restaurants";
import { getDefaultPublicMarket } from "@/lib/publicMarket";

export const metadata = { title: "Map · FoodSwipe" };

function httpsUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password || /^\/map\/?$/.test(url.pathname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function isPublicHtmlPage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    await response.body?.cancel();
    return response.status === 200 && contentType === "text/html";
  } catch {
    return false;
  }
}

async function getMapConfiguration() {
  if (process.env.FOODSWIPE_MAP_ENABLED !== "true") return null;
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY?.trim();
  const mapId = process.env.GOOGLE_MAPS_MAP_ID?.trim();
  const terms = httpsUrl(process.env.FOODSWIPE_MAP_TERMS_URL);
  const privacy = httpsUrl(process.env.FOODSWIPE_MAP_PRIVACY_URL);
  const market = getDefaultPublicMarket(process.env.FOODSWIPE_DEFAULT_MARKET?.trim() || "nyc");
  if (!key || key === process.env.GOOGLE_MAPS_API_KEY?.trim()
    || !mapId || mapId === "DEMO_MAP_ID" || !terms || !privacy || terms === privacy || !market) return null;

  // The enable flag confirms review of the policy text. Check the canonical pages are still reachable.
  const pages = await Promise.all([isPublicHtmlPage(terms), isPublicHtmlPage(privacy)]);
  return pages.every(Boolean) ? { key, mapId, market, terms, privacy } : null;
}

export default async function MapPage() {
  await connection();
  const config = await getMapConfiguration();

  // The map boundary carries only slugs and durable Place IDs, never stored coordinates.
  const targets = config ? (await getPublishedRestaurants(config.market)).flatMap((restaurant) => {
    const placeId = restaurant.googlePlaceId?.trim();
    return placeId ? [{ slug: restaurant.id, placeId }] : [];
  }) : [];

  return (
    <AppShell>
      <main className="flex min-h-0 flex-1 flex-col bg-ink">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-saffron">Discover</p>
            <h1 className="font-display text-xl font-bold text-cream">Restaurant map</h1>
          </div>
          <Link href="/feed" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm font-semibold text-cream">
            <MaterialIcon name="style" className="text-lg" /> Swipe
          </Link>
        </header>
        {config ? (
          <MapDiscovery browserKey={config.key} mapId={config.mapId} market={config.market} targets={targets} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <h2 className="text-lg font-semibold text-cream">Map unavailable</h2>
            <p className="text-sm text-haze">Map discovery hasn’t been configured for this environment.</p>
          </div>
        )}
        {config && (
          <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-4 py-1.5 text-xs text-haze">
            <a href={config.terms} className="underline">Terms of Use</a>
            <a href={config.privacy} className="underline">Privacy Policy</a>
          </footer>
        )}
      </main>
    </AppShell>
  );
}
