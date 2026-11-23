import { adminError, adminJson, adminUrl } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { attachVideoCandidate } from "@/lib/db/videoCandidates";

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
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

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
        return adminError(400, "expected_slug_required", "Expected restaurant slug is required in the request body.", { field: "expectedRestaurantSlug" });
      }
      expectedRestaurantSlug = slug.trim();
    }
  } catch {
    return adminError(400, "invalid_json", "Invalid JSON body.");
  }

  const { id } = await params;
  let result;
  try {
    result = await attachVideoCandidate(id, expectedRestaurantSlug, auditContext(auth));
  } catch {
    return adminError(500, "attach_failed", "Could not confirm attachment. Refresh the queue and retry if it is still approved.", { retryable: true });
  }

  if (result.ok) {
    return adminJson(
      {
        videoId: result.videoId, candidate: result.candidate, alreadyAttached: result.alreadyAttached,
        restaurantSlug: result.restaurantSlug, id: result.candidate.id,
        adminUrl: adminUrl(req, "/admin/videos/candidates", { candidate: result.candidate.id }),
      },
      result.alreadyAttached ? 200 : 201,
    );
  }

  switch (result.code) {
    case "no-db":
      return adminError(503, "database_unavailable", "Database not configured (DATABASE_URL not set).");
    case "not-found":
      return adminError(404, "not_found", "Candidate not found.");
    case "target-changed":
      return adminError(409, "target_changed", "The restaurant this video is linked to changed, was hidden, or no longer matches what you confirmed. Refresh the queue and verify the target before attaching.");
    case "target-required":
      return adminError(400, "target_required", "Confirm the restaurant slug the video will be attached to before attaching.", { field: "expectedRestaurantSlug" });
    case "attachment-inconsistent":
      return adminError(409, "attachment_inconsistent", "This candidate has an incomplete attachment record. Verify the restaurant's videos before repairing the record.");
    case "not-approved":
      return adminError(400, "not_approved", `Candidate must be "approved" before attaching (currently "${result.status}").`, { status: result.status });
    case "restaurant-not-found":
      return adminError(422, "restaurant_not_published", "The restaurant this video is linked to is not published yet. Publish the restaurant first; the video stays linked by ID.", { slug: result.slug });
    case "invalid-video":
      return adminError(422, "invalid_video", "Candidate could not be turned into a valid video.");
  }
}
