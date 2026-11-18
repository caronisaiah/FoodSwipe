import Link from "next/link";
import AppShell from "@/components/AppShell";
import MapboxDiscovery from "@/components/MapboxDiscovery";
import MaterialIcon from "@/components/MaterialIcon";
import { getApprovedMapLocations } from "@/lib/db/restaurantLocations";
import { getMarketDisplayName } from "@/lib/markets";
import { getDiscoveryMarket } from "@/lib/discoveryMarket";

export const metadata = { title: "Restaurant map · FoodSwipe" };

export default async function MapPage() {
  const token = process.env.MAPBOX_PUBLIC_TOKEN?.trim();
  const { market } = await getDiscoveryMarket();
  const enabled = process.env.FOODSWIPE_MAP_ENABLED === "true"
    && token && /^pk\.[\w-]+\.[\w-]+$/.test(token) && market;
  const locations = enabled ? await getApprovedMapLocations(market).catch(() => null) : null;

  return (
    <AppShell wide>
      <main className="flex min-h-0 flex-1 flex-col bg-ink">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold text-saffron">{market ? getMarketDisplayName(market) : "Discover"}</p>
            <h1 className="font-display text-2xl font-bold text-cream sm:text-3xl">Restaurant map</h1>
          </div>
          <Link href="/feed" className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-2 text-sm font-semibold text-cream">
            <MaterialIcon name="style" className="text-lg" /> Swipe
          </Link>
        </header>
        {enabled && locations?.length ? (
          <MapboxDiscovery key={market} token={token} market={market} locations={locations} />
        ) : (
          <div className="grid flex-1 place-items-center px-6">
            <div className="max-w-xs text-center">
              <MaterialIcon name="map" className="mb-3 text-3xl text-saffron" />
              <h2 className="font-display text-xl font-bold text-cream">
                {locations ? "No restaurants on the map yet" : "Map unavailable"}
              </h2>
              <p className="mt-2 text-sm text-haze">
                {locations ? "You can still find curated restaurants in Swipe." : enabled
                  ? "Restaurant locations couldn’t load. Try again or return to Swipe."
                  : "Map discovery isn’t available yet. Explore restaurants in Swipe."}
              </p>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
