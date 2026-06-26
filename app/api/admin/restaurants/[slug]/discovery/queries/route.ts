import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { generateDiscoveryQueries } from "@/lib/discovery/queryGenerator";

/*
  GET /api/admin/restaurants/[slug]/discovery/queries  (INTERNAL, admin-secret)

  Social video discovery — Slice 1. Returns deterministic, name-anchored search
  queries an admin can run manually to find TikTok/Instagram/YouTube review
  videos for this restaurant. PURELY READ-ONLY: no DB writes, no external search
  calls, no candidate creation — it only builds query strings + search URLs.

  Guards mirror the other admin routes: 503 if FOODSWIPE_ADMIN_SECRET unset · 401
  if the header is missing/wrong. (No DATABASE_URL guard: seed restaurants resolve
  without a DB, so discovery works offline for them too.) `no-store`.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }

  const queries = generateDiscoveryQueries({
    name: restaurant.name,
    slug: restaurant.id, // public slug (seed id or published slug)
    market: restaurant.market,
    neighborhood: restaurant.neighborhood,
    address: restaurant.address,
    cuisineTags: restaurant.cuisineTags,
    dishHighlights: restaurant.dishHighlights,
    websiteDomain: restaurant.websiteDomain,
  });

  return Response.json(
    { restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.id }, queries },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
