import { adminError, adminJson, adminUrl } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
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
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let result;
  try {
    result = await promoteCandidateToRestaurant(id, auditContext(auth));
  } catch {
    return adminError(500, "promote_failed", "Failed to promote candidate.", { retryable: true });
  }

  if (result.ok) {
    return adminJson(
      {
        restaurant: result.restaurant, heroSelectionWarning: result.heroSelectionWarning,
        id: result.restaurant.id, slug: result.restaurant.slug,
        adminUrl: adminUrl(req, "/admin/restaurants/published"),
        candidateAdminUrl: adminUrl(req, "/admin/restaurants/candidates", { candidate: id }),
      },
      201,
    );
  }

  switch (result.code) {
    case "no-db":
      return adminError(503, "database_unavailable", "Database not configured (DATABASE_URL not set).");
    case "not-found":
      return adminError(404, "not_found", "Candidate not found.");
    case "not-approved":
      return adminError(400, "not_approved", `Candidate must be "approved" before promotion (currently "${result.status}").`, { status: result.status });
    case "incomplete":
      return adminError(422, "incomplete_candidate", result.invalidCoordinates?.length
        ? `Candidate has invalid coordinates: ${result.invalidCoordinates[0].message}`
        : "Candidate is missing required feed fields.", {
        missingFields: result.missingFields,
        errors: result.invalidCoordinates,
      });
    case "already-promoted":
      return adminError(409, "already_promoted", "Candidate has already been promoted.", {
        restaurant: result.restaurant, heroSelectionWarning: result.heroSelectionWarning,
      });
    case "place-already-published":
      return adminError(409, "place_already_published", "Another published restaurant already uses this Google Place ID.", {
        restaurant: result.restaurant,
      });
    default:
      return adminError(500, "promote_failed", "Failed to promote candidate.", { retryable: true });
  }
}
