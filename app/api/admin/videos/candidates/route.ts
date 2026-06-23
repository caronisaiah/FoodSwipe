import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import {
  createVideoCandidate,
  isDbConfigured,
  listVideoCandidates,
} from "@/lib/db/videoCandidates";
import { resolveSocialVideo } from "@/lib/socialVideo";

/*
  /api/admin/videos/candidates  (INTERNAL, admin-secret)

  Social-video intake/review queue (Phase 1). NOTHING here is shown on a profile;
  a candidate only reaches restaurant_videos via an explicit attach of an APPROVED
  candidate. Guards mirror the other admin routes: 503 no secret · 401 bad secret
  · 503 no DB.

  POST  Body: { sourceUrl, restaurantSlug?, candidateRestaurantId?,
                proposedRestaurantName?, reviewNotes? }
        → resolves the URL (TikTok/Instagram/YouTube), inserts a needs_review
          candidate. 422 on unsupported/invalid URL. 409 (with existing) on dup.
  GET   ?status=&platform=&restaurantSlug=  → { candidates }
*/

function guard(req: Request): Response | null {
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
  return null;
}

export async function GET(req: Request): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  try {
    const candidates = await listVideoCandidates({
      status: sp.get("status") ?? undefined,
      platform: sp.get("platform") ?? undefined,
      restaurantSlug: sp.get("restaurantSlug") ?? undefined,
    });
    return Response.json({ candidates });
  } catch {
    return Response.json({ error: "Failed to list candidates." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const denied = guard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const sourceUrl = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
  if (!sourceUrl) {
    return Response.json({ error: "A `sourceUrl` is required." }, { status: 400 });
  }

  const result = await resolveSocialVideo(sourceUrl);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 });
  }
  const r = result.resolved;

  try {
    const { candidate, duplicate } = await createVideoCandidate({
      platform: r.platform,
      sourceUrl: r.sourceUrl,
      normalizedSourceUrl: r.normalizedSourceUrl,
      platformVideoId: r.platformVideoId,
      creatorHandle: r.creatorHandle,
      creatorName: r.creatorName,
      caption: r.caption,
      thumbnailUrl: r.thumbnailUrl,
      embedUrl: r.embedUrl,
      attributionText: r.attributionText,
      publishedAt: r.publishedAt,
      sourceFetchedAt: r.sourceFetchedAt,
      legalDisplayStatus: r.legalDisplayStatus,
      resolverStatus: r.resolverStatus,
      resolverError: r.resolverError,
      // Review-routing fields from the request body.
      restaurantSlug: typeof b.restaurantSlug === "string" ? b.restaurantSlug : null,
      candidateRestaurantId: typeof b.candidateRestaurantId === "string" ? b.candidateRestaurantId : null,
      proposedRestaurantName: typeof b.proposedRestaurantName === "string" ? b.proposedRestaurantName : null,
      reviewNotes: typeof b.reviewNotes === "string" ? b.reviewNotes : null,
    });
    if (duplicate) {
      return Response.json(
        { error: "A candidate for this video already exists.", candidate },
        { status: 409 },
      );
    }
    return Response.json({ candidate }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to create candidate." }, { status: 500 });
  }
}
