import { desc, eq, or } from "drizzle-orm";
import type { Video } from "@/lib/types";
import type { CaptionSource } from "@/lib/tagSuggester";
import { getDb } from "./index";
import { videoCandidates } from "./schema";
import { getActiveVideos } from "./videos";
import { listVideoCandidates } from "./videoCandidates";

/**
 * Tag Automation B2 — server-only caption collectors for the suggestion engine.
 *
 * Gathers EXISTING, already-stored caption text for a restaurant so the engine can
 * surface review-only tag hints. This module READS ONLY: no writes, no external
 * calls, no URL fetching, no media download, no scraping. Results are bounded.
 */

const MAX_CAPTIONS = 20;

/** Caption text must be a usable, non-empty string. */
function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Bound + de-dupe by caption text (case-insensitive), most-trusted first. */
function bound(sources: CaptionSource[]): CaptionSource[] {
  const seen = new Set<string>();
  const out: CaptionSource[] = [];
  for (const s of sources) {
    const key = s.caption.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_CAPTIONS) break;
  }
  return out;
}

/**
 * Caption sources for a CANDIDATE restaurant. video_candidates are linked either by
 * `candidateRestaurantId` (discovery candidates created for this candidate) or by a
 * proposed `restaurantSlug`. Empty without a DB.
 */
export async function collectCandidateCaptionSources(
  candidateId: string,
  candidateSlug?: string | null,
): Promise<CaptionSource[]> {
  const db = getDb();
  if (!db) return [];
  const slug = clean(candidateSlug);
  const where = slug
    ? or(eq(videoCandidates.candidateRestaurantId, candidateId), eq(videoCandidates.restaurantSlug, slug))
    : eq(videoCandidates.candidateRestaurantId, candidateId);
  try {
    const rows = await db
      .select({
        caption: videoCandidates.caption,
        creatorHandle: videoCandidates.creatorHandle,
        creatorName: videoCandidates.creatorName,
        platform: videoCandidates.platform,
        sourceUrl: videoCandidates.sourceUrl,
      })
      .from(videoCandidates)
      .where(where)
      .orderBy(desc(videoCandidates.createdAt))
      .limit(MAX_CAPTIONS);
    const sources: CaptionSource[] = [];
    for (const r of rows) {
      const caption = clean(r.caption);
      if (!caption) continue;
      sources.push({
        caption,
        creatorHandle: r.creatorHandle,
        creatorName: r.creatorName,
        platform: r.platform,
        sourceUrl: r.sourceUrl,
        origin: "video_candidate_caption",
      });
    }
    return bound(sources);
  } catch {
    return []; // a read hiccup must never break the (suggestion-only) route
  }
}

/**
 * Caption sources for a PUBLISHED or SEED restaurant (by app slug = restaurant id):
 *  - attached restaurant_videos (human-vetted; most trusted)
 *  - in-memory seed `restaurant.videos` (curated captions; skips placeholders)
 *  - video_candidates proposed for this slug (least trusted)
 * Empty/seed-only without a DB. No external calls.
 */
export async function collectRestaurantCaptionSources(
  slug: string,
  seedVideos?: Video[] | null,
): Promise<CaptionSource[]> {
  const sources: CaptionSource[] = [];

  // In-memory seed/curated captions (real sources only — never placeholders).
  for (const v of Array.isArray(seedVideos) ? seedVideos : []) {
    const caption = clean(v.caption);
    if (!caption) continue;
    if (v.legalDisplayStatus === "placeholder-only" || v.sourceType === "placeholder") continue;
    sources.push({
      caption,
      creatorHandle: v.creatorHandle ?? null,
      creatorName: v.creatorDisplayName ?? null,
      platform: v.platform ?? null,
      sourceUrl: v.sourceUrl ?? null,
      origin: "attached_video_caption",
    });
  }

  try {
    // Attached DB videos (restaurant_videos.restaurantId === app slug).
    const attached = await getActiveVideos(slug);
    for (const v of attached) {
      const caption = clean(v.caption);
      if (!caption) continue;
      if (v.legalDisplayStatus === "placeholder-only" || v.sourceType === "placeholder") continue;
      sources.push({
        caption,
        creatorHandle: v.creatorHandle ?? null,
        creatorName: v.creatorDisplayName ?? null,
        platform: v.platform ?? null,
        sourceUrl: v.sourceUrl ?? null,
        origin: "attached_video_caption",
      });
    }

    // Proposed video candidates targeting this slug (least trusted).
    const candidates = await listVideoCandidates({ restaurantSlug: slug });
    for (const c of candidates) {
      const caption = clean(c.caption);
      if (!caption) continue;
      sources.push({
        caption,
        creatorHandle: c.creatorHandle,
        creatorName: c.creatorName,
        platform: c.platform,
        sourceUrl: c.sourceUrl,
        origin: "video_candidate_caption",
      });
    }
  } catch {
    // ignore DB hiccups — seed captions (if any) still return
  }

  return bound(sources);
}
