import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getActiveVideos, insertVideo, isDbConfigured } from "@/lib/db/videos";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { resolveSocialVideo } from "@/lib/socialVideo";
import { normalizeVideo } from "@/lib/video";
import type { Platform } from "@/lib/types";

/*
  POST /api/admin/restaurants/[slug]/videos  (INTERNAL, admin-secret)

  Direct "add a video to this profile" for the admin profile editor — resolves a
  TikTok/Instagram/YouTube URL through the SAME official resolver + legal-safe
  normalizeVideo, then inserts into restaurant_videos for the restaurant (seed OR
  published, resolved by slug/id). The admin curating the profile IS the reviewer,
  so this is a deliberate direct attach (parallel to /api/admin/videos); it does
  not download/rehost — official embed/link only.

  Dedupe: refuses if the same source URL is already an active video on this
  restaurant. Guards: 503 no secret · 401 bad secret · 503 no DB · 404 unknown
  restaurant · 422 unsupported URL.
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
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const sourceUrl = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
  if (!sourceUrl) {
    return Response.json({ error: "A `sourceUrl` is required." }, { status: 400 });
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: `No seed or published restaurant for "${slug}".` }, { status: 404 });
  }

  const result = await resolveSocialVideo(sourceUrl);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 });
  }
  const r = result.resolved;

  try {
    // Dedupe: don't add the same source twice to one restaurant.
    const existing = await getActiveVideos(restaurant.id);
    if (existing.some((v) => v.sourceUrl === r.sourceUrl)) {
      return Response.json({ error: "That video is already attached to this restaurant." }, { status: 409 });
    }

    const platform = PLATFORM_MAP[r.platform] ?? "Web";
    // normalizeVideo re-applies the legal-safe invariants (embed allowlist, etc.).
    const video = normalizeVideo({
      id: `add-${crypto.randomUUID()}`,
      platform,
      sourceUrl: r.sourceUrl,
      embedUrl: r.embedUrl ?? undefined,
      creatorHandle: r.creatorHandle ?? "@unknown",
      creatorDisplayName: r.creatorName ?? undefined,
      caption: r.caption ?? "",
      thumbnailUrl: r.thumbnailUrl ?? undefined,
      attributionText: r.attributionText ?? `${platform} post`,
      publishedAt: r.publishedAt ?? undefined,
      discoveredAt: new Date().toISOString().slice(0, 10),
      isRealSource: true,
      sourceType: "real-post",
      matchConfidence: "manual",
      legalDisplayStatus: r.legalDisplayStatus,
    });
    if (!video) {
      return Response.json({ error: "Could not build a valid video from that URL." }, { status: 422 });
    }

    const saved = await insertVideo(restaurant.id, video);
    return Response.json({ video: saved }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to add video." }, { status: 500 });
  }
}
