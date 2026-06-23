import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured } from "@/lib/db/candidates";
import { hidePublishedRestaurant } from "@/lib/db/restaurants";

/*
  POST /api/admin/restaurants/published/[id]/hide  (INTERNAL, admin-secret)

  Convenience action: set a published restaurant's status to "hidden" so it stops
  serving to the feed (the row is kept, not deleted). Equivalent to PATCH with
  { status: "hidden" }. Guards: 503 no secret · 401 bad secret · 503 no DB · 404.
*/
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503 },
    );
  }

  const { id } = await params;
  try {
    const restaurant = await hidePublishedRestaurant(id);
    if (!restaurant) {
      return Response.json({ error: "Published restaurant not found." }, { status: 404 });
    }
    return Response.json({ restaurant });
  } catch {
    return Response.json({ error: "Failed to hide restaurant." }, { status: 500 });
  }
}
