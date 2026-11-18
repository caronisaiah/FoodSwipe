import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { getAppRestaurantsByIds } from "@/lib/db/restaurants";
import type { SavedRestaurant } from "@/lib/types";

export async function GET(req: Request): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  const headers = { "Cache-Control": "no-store" };
  if (!ids.length || ids.length > 25 || ids.some((id) => !id || id.length > 256)) {
    return Response.json({ error: "Invalid saved restaurant IDs." }, { status: 400, headers });
  }

  try {
    const matches = await getAppRestaurantsByIds([...new Set(ids)], {
      includeSeeds: shouldIncludeSeedRestaurants(),
    });
    const restaurants: SavedRestaurant[] = matches.map(
      ({ id, name, market, neighborhood, priceLevel, cuisineTags, vibeTags, videoCount }) =>
        ({ id, name, market, neighborhood, priceLevel, cuisineTags, vibeTags, videoCount }),
    );
    return Response.json({ restaurants }, { headers });
  } catch {
    return Response.json({ error: "Saved details couldn’t load." }, { status: 503, headers });
  }
}
