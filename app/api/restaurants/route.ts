import { getAllRestaurants } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { isAllowedMarket } from "@/lib/markets";
import { getDiscoveryMarket, getDiscoveryMarketSettings } from "@/lib/discoveryMarket";

/** Public discovery catalogue, scoped to an enabled or explicitly selected market. */
export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams.getAll("market");
  const explicit = params[0];
  if (params.length > 1 || (explicit !== undefined && !isAllowedMarket(explicit))) {
    return noStore({ error: "Invalid discovery market." }, 400);
  }

  const market = explicit ?? (await getDiscoveryMarket()).market;
  if (!market) return noStore({ error: "Discovery market unavailable." }, 503);
  if (!getDiscoveryMarketSettings().selectableMarkets.includes(market)) {
    return noStore({ error: "Discovery market unavailable." }, 403);
  }

  try {
    const restaurants = await getAllRestaurants(market, { includeSeeds: shouldIncludeSeedRestaurants() });
    return noStore({ market, restaurants }, 200);
  } catch {
    return noStore({ error: "Restaurants couldn’t load." }, 503);
  }
}

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
