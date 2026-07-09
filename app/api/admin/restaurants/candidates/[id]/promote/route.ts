import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured } from "@/lib/db/candidates";
import { promoteCandidateToRestaurant } from "@/lib/db/restaurants";

/*
  POST /api/admin/restaurants/candidates/[id]/promote  (INTERNAL, admin-secret)

  Explicit promotion of a REVIEWED candidate into a published/live feed
  restaurant. This is the ONLY path from candidate → feed; nothing auto-publishes.

  Rules (enforced in lib/db/restaurants.promoteCandidateToRestaurant):
    - candidate must exist (404) and be status "approved" (400 otherwise);
    - must have the required feed fields or 422 with { missingFields };
    - one published restaurant per candidate AND per googlePlaceId (409, returns
      the existing restaurant) — never a duplicate;
    - copies only reviewed/curated fields; sets neutral (0) metrics; never
      publishes videos or mutates Google photo data.

  Guards mirror the other admin routes: 503 no secret · 401 bad secret · 503 no DB.
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
  let result;
  try {
    result = await promoteCandidateToRestaurant(id);
  } catch {
    return Response.json({ error: "Failed to promote candidate." }, { status: 500 });
  }

  if (result.ok) {
    return Response.json(
      { restaurant: result.restaurant, heroSelectionWarning: result.heroSelectionWarning },
      { status: 201 },
    );
  }

  switch (result.code) {
    case "no-db":
      return Response.json(
        { error: "Database not configured (DATABASE_URL not set)." },
        { status: 503 },
      );
    case "not-found":
      return Response.json({ error: "Candidate not found." }, { status: 404 });
    case "not-approved":
      return Response.json(
        {
          error: `Candidate must be "approved" before promotion (currently "${result.status}").`,
          status: result.status,
        },
        { status: 400 },
      );
    case "incomplete":
      return Response.json(
        {
          error: "Candidate is missing required feed fields.",
          missingFields: result.missingFields,
        },
        { status: 422 },
      );
    case "already-promoted":
      return Response.json(
        {
          error: "Candidate has already been promoted.",
          restaurant: result.restaurant,
          heroSelectionWarning: result.heroSelectionWarning,
        },
        { status: 409 },
      );
    case "place-already-published":
      return Response.json(
        {
          error: "Another published restaurant already uses this Google Place ID.",
          restaurant: result.restaurant,
        },
        { status: 409 },
      );
    default:
      return Response.json({ error: "Failed to promote candidate." }, { status: 500 });
  }
}
