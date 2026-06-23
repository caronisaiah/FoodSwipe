import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured } from "@/lib/db/candidates";
import { listPublishedRestaurantsForAdmin } from "@/lib/db/restaurants";

/*
  GET /api/admin/restaurants/published  (INTERNAL, admin-secret)

  Lists DB-published/live restaurants (BOTH "published" and "hidden") for the
  admin editor. Seed restaurants are code-managed and NOT returned here. Guards
  mirror the other admin routes: 503 no secret · 401 bad secret · 503 no DB.
*/
export async function GET(req: Request): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503 },
    );
  }

  try {
    const restaurants = await listPublishedRestaurantsForAdmin();
    return Response.json({ restaurants });
  } catch {
    return Response.json({ error: "Failed to list published restaurants." }, { status: 500 });
  }
}
