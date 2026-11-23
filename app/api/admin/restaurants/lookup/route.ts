import { adminError, adminJson } from "@/lib/adminApi";
import { guardAdmin } from "@/lib/adminGuard";
import { validateMarket } from "@/lib/adminValidation";
import { searchRestaurantTargets } from "@/lib/db/identity";

/*
  GET /api/admin/restaurants/lookup?q=&market=&limit=   (INTERNAL, draft credential or higher)

  Read-only search over restaurant candidates AND DB-published restaurants (name, address, slug or exact
  Google Place ID). It backs the admin restaurant selector so a video is linked to a real record by its
  stable id instead of a typed slug. `market` is optional here; when given it must be valid.
  200 -> { results: [{ kind: "candidate"|"published", id, name, slug, market, address, status,
                      googlePlaceId, publishedSlug }] }
  For a candidate that has been promoted, `publishedSlug` is its live slug.
*/
export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length > 200) return adminError(422, "validation_failed", "q must be at most 200 characters.", { field: "q" });
  let market: string | undefined;
  if (sp.get("market") !== null && sp.get("market") !== "") {
    const m = validateMarket(sp.get("market"));
    if (!m.ok) return adminError(422, m.error.code, m.error.message, { field: "market", errors: [m.error] });
    market = m.market;
  }
  const rawLimit = Number(sp.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
  try {
    const results = await searchRestaurantTargets(q, { market, limit });
    return adminJson({ results, adminScope: auth.scope });
  } catch {
    return adminError(500, "lookup_failed", "Restaurant lookup failed.", { retryable: true });
  }
}
