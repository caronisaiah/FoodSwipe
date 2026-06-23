import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured, patchVideoCandidate } from "@/lib/db/videoCandidates";

/*
  PATCH /api/admin/videos/candidates/[id]  (INTERNAL, admin-secret)

  Additive edit of review fields only: status, restaurantSlug,
  proposedRestaurantName, creatorHandle, caption, attributionText,
  matchConfidence, matchReasons, reviewNotes. Immutable source identity
  (sourceUrl/normalizedSourceUrl/platform/platformVideoId/resolver*) is NOT
  editable here. Guards: 503 no secret · 401 bad secret · 503 no DB · 404 unknown.
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
    const candidate = await patchVideoCandidate(id, body);
    if (!candidate) {
      return Response.json({ error: "Candidate not found." }, { status: 404 });
    }
    return Response.json({ candidate });
  } catch {
    return Response.json({ error: "Failed to update candidate." }, { status: 500 });
  }
}
