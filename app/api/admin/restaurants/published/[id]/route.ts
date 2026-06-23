import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured } from "@/lib/db/candidates";
import { updatePublishedRestaurant } from "@/lib/db/restaurants";

/*
  PATCH /api/admin/restaurants/published/[id]  (INTERNAL, admin-secret)

  Edit a DB-published restaurant by its uuid. Additive — only fields present in
  the body are written. Tag arrays are filtered to the controlled vocab (impossible
  tags are dropped, never persisted). Editable: name, neighborhood, address,
  websiteDomain, googlePlaceId, lat, lng, priceLevel, cuisineTags, dietaryTags,
  vibeTags, bestFor, dishHighlights, reasonText, status (published|hidden).
  NOT editable: sourceCandidateId, slug, id, or the neutral metric fields.

  Seed restaurants are NOT editable here (this route only touches the DB table).
  Changes are reflected on the next runtime feed read (no-store API). Guards:
  503 no secret · 401 bad secret · 503 no DB · 404 unknown id.
*/
export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const restaurant = await updatePublishedRestaurant(id, body);
    if (!restaurant) {
      return Response.json({ error: "Published restaurant not found." }, { status: 404 });
    }
    return Response.json({ restaurant });
  } catch {
    // Most likely a unique-index conflict (e.g. editing googlePlaceId to one
    // already used by another published restaurant).
    return Response.json(
      { error: "Failed to update (possibly a duplicate Google Place ID)." },
      { status: 409 },
    );
  }
}
