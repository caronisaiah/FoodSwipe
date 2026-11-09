import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { attachVideoCandidate, isDbConfigured } from "@/lib/db/videoCandidates";

/*
  POST /api/admin/videos/candidates/[id]/attach  (INTERNAL, admin-secret)

  The ONLY path from the review queue into restaurant_videos. Requires the
  candidate to be "approved" and to match an explicitly confirmed, published
  restaurant slug. Stores the video and marks the candidate attached atomically.
  Idempotent (already-attached returns the existing video). NEVER attaches a
  rejected/needs_review candidate; never auto-runs.

  Guards: 503 no secret · 401 bad secret · 503 no DB.
  The review UI sends the saved slug it is attaching to; a stale target returns 409.
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

  let expectedRestaurantSlug: string | undefined;
  // Bodyless requests can retrieve an existing attachment, but cannot create one.
  try {
    const payload = await req.text();
    if (payload.length > 0) {
      const body: unknown = JSON.parse(payload);
      const slug = body && typeof body === "object" && "expectedRestaurantSlug" in body
        ? body.expectedRestaurantSlug
        : null;
      if (typeof slug !== "string" || !slug.trim()) {
        return Response.json({ error: "Expected restaurant slug is required in the request body." }, { status: 400 });
      }
      expectedRestaurantSlug = slug.trim();
    }
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = await params;
  let result;
  try {
    result = await attachVideoCandidate(id, expectedRestaurantSlug);
  } catch {
    return Response.json({ error: "Could not confirm attachment. Refresh the queue and retry if it is still approved." }, { status: 500 });
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
    case "target-changed":
      return Response.json({ error: "The saved restaurant changed. Refresh the queue and verify the target before attaching." }, { status: 409 });
    case "target-required":
      return Response.json({ error: "Confirm the saved restaurant slug before attaching." }, { status: 400 });
    case "attachment-inconsistent":
      return Response.json({ error: "This candidate has an incomplete attachment record. Verify the restaurant's videos before repairing the record." }, { status: 409 });
    case "not-approved":
      return Response.json(
        {
          error: `Candidate must be "approved" before attaching (currently "${result.status}").`,
          status: result.status,
        },
        { status: 400 },
      );
    case "restaurant-not-found":
      return Response.json(
        { error: `No published restaurant found for slug "${result.slug}".`, slug: result.slug },
        { status: 422 },
      );
    case "invalid-video":
      return Response.json({ error: "Candidate could not be turned into a valid video." }, { status: 422 });
  }
}
