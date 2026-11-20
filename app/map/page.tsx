import type { Viewport } from "next";
import Link from "next/link";
import EditorialHeader from "@/components/editorial/EditorialHeader";
import MapboxDiscovery from "@/components/MapboxDiscovery";
import MaterialIcon from "@/components/MaterialIcon";
import { getApprovedMapLocations } from "@/lib/db/restaurantLocations";
import { getMarketDisplayName } from "@/lib/markets";
import { getDiscoveryMarket } from "@/lib/discoveryMarket";

export const metadata = { title: "Restaurant map · FoodSwipe" };
export const viewport: Viewport = {
  themeColor: "#f8f1e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function MapPage() {
  const token = process.env.MAPBOX_PUBLIC_TOKEN?.trim();
  const { market } = await getDiscoveryMarket();
  const enabled = process.env.FOODSWIPE_MAP_ENABLED === "true"
    && token && /^pk\.[\w-]+\.[\w-]+$/.test(token) && market;
  const locations = enabled ? await getApprovedMapLocations(market).catch(() => null) : null;

  return (
    <div className="editorial-canvas map-page">
      <EditorialHeader
        skipTo="map-title"
        skipLabel="Skip to the restaurant map"
        trailing={<Link href="/feed" className="map-swipe-link">Swipe view</Link>}
      />
      <main className="map-main">
        {enabled && locations?.length ? (
          <MapboxDiscovery key={market} token={token} market={market} marketName={getMarketDisplayName(market)} locations={locations} />
        ) : (
          <div className="map-unavailable">
            <MaterialIcon name="map" />
            <h1 id="map-title" className="editorial-page-title">
              {locations ? "No restaurants on the map yet" : "Map unavailable"}
            </h1>
            <p>
              {locations ? "You can still find curated restaurants in Swipe." : enabled
                ? "Restaurant locations couldn’t load. Try again or return to Swipe."
                : "Map discovery isn’t available yet. Explore restaurants in Swipe."}
            </p>
            <Link href="/feed" className="editorial-action">Open Swipe <MaterialIcon name="arrow_forward" /></Link>
          </div>
        )}
      </main>
    </div>
  );
}
