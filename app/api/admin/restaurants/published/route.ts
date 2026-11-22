import { guardAdmin } from "@/lib/adminGuard";
import { listPublishedRestaurantsForAdmin } from "@/lib/db/restaurants";

/*
  GET /api/admin/restaurants/published  (INTERNAL, admin-secret)

  Lists DB-published/live restaurants (BOTH "published" and "hidden") for the
  admin editor. Seed restaurants are code-managed and NOT returned here. Guards
  mirror the other admin routes: 503 no secret · 401 bad secret · 503 no DB.
*/
export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;

  try {
    const restaurants = await listPublishedRestaurantsForAdmin();
    return Response.json({ restaurants });
  } catch {
    return Response.json({ error: "Failed to list published restaurants." }, { status: 500 });
  }
}
