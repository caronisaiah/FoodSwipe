import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured } from "@/lib/db/candidates";
import { getPlacePhotoCandidates, type PlacePhotoStatus } from "@/lib/places";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorForStatus(status: PlacePhotoStatus): string | undefined {
  if (status === "missing-api-key") return "Google Maps API key is not configured.";
  if (status === "missing-google-place-id") return "Candidate has no Google Place ID.";
  if (status === "place-details-failed") return "Google Place Details request failed.";
  if (status === "no-photos") return "Google returned no photos for this exact Place ID.";
  if (status === "invalid-photo-ordinal") return "Selected photo ordinal is unavailable for this Place ID.";
  if (status === "photo-media-failed") return "Google photo media request failed.";
  if (status === "error") return "Google photo candidate lookup failed.";
  return undefined;
}

function httpStatusFor(status: PlacePhotoStatus): number {
  if (status === "missing-api-key") return 503;
  if (status === "place-details-failed" || status === "photo-media-failed" || status === "error") {
    return 502;
  }
  return 200;
}

/*
  GET /api/admin/restaurants/candidates/[id]/photo-candidates

  INTERNAL, admin-secret, read-only preview for P2B. Fetches up to ten Google
  Place Photo candidates for the candidate's exact googlePlaceId and resolves
  fresh ephemeral photoUri values for display. It never writes to the DB, never
  returns/stores Google photo names, never downloads/proxies image bytes, and
  always sends no-store because photoUri values are short-lived.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return json({ error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." }, 503);
  }
  if (!hasValidAdminSecret(req)) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!isDbConfigured()) {
    return json({ error: "Database not configured (DATABASE_URL not set)." }, 503);
  }

  const { id } = await params;
  const candidate = await getCandidateRestaurant(id); // SELECT only - no writes
  if (!candidate) {
    return json({ error: "Candidate not found." }, 404);
  }

  const result = await getPlacePhotoCandidates(candidate.googlePlaceId ?? "", 10);
  const error = errorForStatus(result.status);

  return json(
    {
      error,
      status: result.status,
      candidate: {
        id: candidate.id,
        name: candidate.name,
        googlePlaceId: candidate.googlePlaceId,
        websiteDomain: candidate.websiteDomain,
      },
      candidates: result.candidates,
      diagnostics: {
        requestedCount: result.requestedCount,
        detailsPhotoCount: result.detailsPhotoCount,
        resolvedCount: result.resolvedCount,
        failedCount: result.failedCount,
        httpStatus: result.httpStatus,
        googleStatus: result.googleStatus,
        sourceProvider: "google_places",
        relationship: "exact_location",
      },
    },
    httpStatusFor(result.status),
  );
}
