import { adminError, adminJson, adminUrl, validationError } from "@/lib/adminApi";
import { guardAdmin } from "@/lib/adminGuard";
import { validateVideoCandidateBody } from "@/lib/adminVideoValidation";
import { getActiveVideos, insertVideo } from "@/lib/db/videos";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { getPublishedRefBySlug } from "@/lib/db/identity";
import { attachVideoCandidate, createVideoCandidate, patchVideoCandidate } from "@/lib/db/videoCandidates";
import { resolveSocialVideo } from "@/lib/socialVideo";
import { normalizeVideo } from "@/lib/video";
import type { Platform } from "@/lib/types";

/*
  POST /api/admin/restaurants/[slug]/videos  (INTERNAL, PUBLICATION credential only)

  The profile editor's "add a video to this live profile". It exists for a human administrator who has
  already reviewed the video, so a DRAFT credential is refused (403).

  For a DB-published restaurant this no longer writes restaurant_videos directly. It runs the normal
  lifecycle in one request: create a video candidate (globally de-duplicated by URL and video id) ->
  approve -> attach with the same target checks as the review queue. So every live video has a candidate
  record, and a video the queue already holds or has REJECTED cannot be pushed live through this route
  (409 duplicate_video with a link to that record). Code-managed seed restaurants (non-production
  content mode) have no candidate lifecycle and keep the direct insert.

  What this cannot prove: that a human really reviewed the video. That needs an audit trail with an
  actor, which is deliberately a separate follow-up. Today the control is the credential boundary.
*/
const PLATFORM_MAP: Record<string, Platform> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminError(400, "invalid_json", "Invalid JSON body.");
  }
  const parsed = validateVideoCandidateBody(body, "create");
  if (!parsed.ok) return validationError(parsed.errors);
  const w = parsed.value;
  if (w.candidateRestaurantId !== undefined || w.restaurantSlug !== undefined) {
    return validationError([{ field: w.restaurantSlug !== undefined ? "restaurantSlug" : "candidateRestaurantId", code: "unknown_field", message: "The restaurant is the one in the URL; do not send a restaurant reference." }]);
  }
  const sourceUrl = w.sourceUrl!;

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return adminError(404, "restaurant_not_found", `No seed or published restaurant for "${slug}".`);
  }

  const result = await resolveSocialVideo(sourceUrl);
  if (!result.ok) {
    return adminError(422, "unsupported_url", result.error, { field: "sourceUrl" });
  }
  const r = result.resolved;

  try {
    const published = await getPublishedRefBySlug(slug);
    if (published && published.status === "published") {
      // --- DB-published restaurant: go through the candidate lifecycle. ---
      const { candidate, duplicate } = await createVideoCandidate({
        platform: r.platform,
        sourceUrl: r.sourceUrl,
        normalizedSourceUrl: r.normalizedSourceUrl,
        platformVideoId: r.platformVideoId,
        creatorHandle: w.creatorHandle ?? r.creatorHandle,
        creatorName: w.creatorName ?? r.creatorName,
        caption: w.caption ?? r.caption,
        thumbnailUrl: r.thumbnailUrl,
        embedUrl: r.embedUrl,
        attributionText: w.attributionText ?? r.attributionText,
        publishedAt: r.publishedAt,
        sourceFetchedAt: r.sourceFetchedAt,
        legalDisplayStatus: r.legalDisplayStatus,
        resolverStatus: r.resolverStatus,
        resolverError: r.resolverError,
        restaurantSlug: published.slug,
        candidateRestaurantId: published.sourceCandidateId,
        proposedRestaurantName: published.name,
        reviewNotes: w.reviewNotes ?? "Added from the profile editor with the publication credential.",
      });
      const link = adminUrl(req, "/admin/videos/candidates", { candidate: candidate.id });
      if (duplicate) {
        return adminError(409, "duplicate_video", `That video is already in the review queue (${candidate.status}). Resolve it there instead of adding it again.`, {
          existing: { id: candidate.id, status: candidate.status, adminUrl: link },
        });
      }
      const approved = await patchVideoCandidate(candidate.id, { status: "approved" });
      if (!approved.ok) return adminError(500, "add_failed", "Could not approve the new candidate; it stays in the review queue.", { existing: { id: candidate.id, adminUrl: link } });
      const attached = await attachVideoCandidate(candidate.id, published.slug);
      if (!attached.ok) {
        return adminError(409, "attach_failed", `The video was queued but could not be attached (${attached.code}); it stays approved in the review queue.`, {
          existing: { id: candidate.id, status: "approved", adminUrl: link },
        });
      }
      const live = (await getActiveVideos(published.slug)).find((v) => v.id === attached.videoId) ?? null;
      return adminJson({ video: live, videoId: attached.videoId, candidateId: candidate.id, adminUrl: link }, 201);
    }

    // --- Code-managed seed restaurant: no candidate lifecycle exists; keep the direct insert. ---
    const existing = await getActiveVideos(restaurant.id);
    if (existing.some((v) => v.sourceUrl === r.sourceUrl)) {
      return adminError(409, "duplicate_video", "That video is already attached to this restaurant.");
    }
    const platform = PLATFORM_MAP[r.platform] ?? "Web";
    const video = normalizeVideo({
      id: `add-${crypto.randomUUID()}`,
      platform,
      sourceUrl: r.sourceUrl,
      embedUrl: r.embedUrl ?? undefined,
      creatorHandle: w.creatorHandle ?? r.creatorHandle ?? "@unknown",
      creatorDisplayName: w.creatorName ?? r.creatorName ?? undefined,
      caption: w.caption ?? r.caption ?? "",
      thumbnailUrl: r.thumbnailUrl ?? undefined,
      attributionText: w.attributionText ?? r.attributionText ?? `${platform} post`,
      publishedAt: r.publishedAt ?? undefined,
      discoveredAt: new Date().toISOString().slice(0, 10),
      isRealSource: true,
      sourceType: "real-post",
      matchConfidence: "manual",
      legalDisplayStatus: r.legalDisplayStatus,
    });
    if (!video) return adminError(422, "invalid_video", "Could not build a valid video from that URL.");
    const saved = await insertVideo(restaurant.id, video);
    return adminJson({ video: saved }, 201);
  } catch {
    return adminError(500, "add_failed", "Failed to add video. Check the restaurant's videos and the review queue before retrying.", { retryable: false });
  }
}
