import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { attachVideoCandidate, isDbConfigured } from "@/lib/db/videoCandidates";

/*
  POST /api/admin/videos/candidates/[id]/attach  (INTERNAL, admin-secret)

  The ONLY path from the review queue into restaurant_videos. Requires the
  candidate to be status "approved" (else 400) and to have a restaurantSlug that
  resolves to a seed or published restaurant (else 422). Inserts via the existing
  legal-safe normalizeVideo + insertVideo, then marks the candidate "attached".
  Idempotent (already-attached returns the existing video). NEVER attaches a
  rejected/needs_review candidate; never auto-runs.

  Guards: 503 no secret · 401 bad secret · 503 no DB.
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
    result = await attachVideoCandidate(id);
  } catch {
    return Response.json({ error: "Failed to attach candidate." }, { status: 500 });
  }

  if (result.ok) {
    return Response.json(
      { videoId: result.videoId, candidate: result.candidate, alreadyAttached: result.alreadyAttached },
      { status: result.alreadyAttached ? 200 : 201 },
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
          error: `Candidate must be "approved" before attaching (currently "${result.status}").`,
          status: result.status,
        },
        { status: 400 },
      );
    case "missing-slug":
      return Response.json(
        { error: "Candidate has no restaurantSlug — set one before attaching." },
        { status: 422 },
      );
    case "restaurant-not-found":
      return Response.json(
        { error: `No seed or published restaurant found for slug "${result.slug}".`, slug: result.slug },
        { status: 422 },
      );
    case "invalid-video":
      return Response.json({ error: "Candidate could not be turned into a valid video." }, { status: 422 });
    default:
      return Response.json({ error: "Failed to attach candidate." }, { status: 500 });
  }
}
