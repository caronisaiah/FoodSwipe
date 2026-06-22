"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";
import VideoEmbed from "@/components/VideoEmbed";

/** Public profiles show at most this many videos (a DISPLAY rule, not a DB/admin
 * limit — the backend may store more for future ranking/moderation). */
const MAX_PROFILE_VIDEOS = 3;

type Origin = "seed" | "shared" | "local";
interface Item {
  video: Video;
  origin: Origin;
  index: number;
}

// Higher tier = better source affordance (embeddable > source-link > none).
function sourceTier(v: Video): number {
  if (videoCanEmbed(v)) return 2;
  if (videoSourceHref(v)) return 1;
  return 0;
}

// How "enriched" a clip is (official metadata present).
function richness(v: Video): number {
  return (
    (v.thumbnailUrl ? 1 : 0) +
    (v.publishedAt ? 1 : 0) +
    (v.creatorDisplayName ? 1 : 0)
  );
}

function publishedTime(v: Video): number {
  if (!v.publishedAt) return -Infinity;
  const t = Date.parse(v.publishedAt);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Deterministic, transparent display order (NOT the feed ranking engine):
 *   real-post → embeddable/source-link → richer metadata → newer → original order.
 */
function compareForDisplay(a: Item, b: Item): number {
  const realA = a.video.sourceType === "real-post" ? 1 : 0;
  const realB = b.video.sourceType === "real-post" ? 1 : 0;
  if (realA !== realB) return realB - realA;

  const tierA = sourceTier(a.video);
  const tierB = sourceTier(b.video);
  if (tierA !== tierB) return tierB - tierA;

  const richA = richness(a.video);
  const richB = richness(b.video);
  if (richA !== richB) return richB - richA;

  const timeA = publishedTime(a.video);
  const timeB = publishedTime(b.video);
  if (timeA !== timeB) return timeB - timeA;

  return a.index - b.index; // preserve original order as the final tie-breaker
}

/**
 * The profile's video section. Merges three read-only sources — seed (shipped),
 * shared (backend, v1.2), and local (legacy localStorage) — then shows only the
 * top `MAX_PROFILE_VIDEOS` in a clean vertical, same-size stack. Nothing is ever
 * downloaded or rehosted; each clip renders through the legal-safe `VideoEmbed`.
 */
export default function RestaurantVideos({
  restaurantId,
  seedVideos,
  posters,
}: {
  restaurantId: string;
  seedVideos: Video[];
  posters: string[];
}) {
  const { videos: localVideos } = useManualVideos(restaurantId);
  const [shared, setShared] = useState<Video[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${restaurantId}/videos`);
        const data = (await res.json()) as { videos?: Video[] };
        if (!cancelled) setShared(Array.isArray(data.videos) ? data.videos : []);
      } catch {
        if (!cancelled) setShared([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const merged: Item[] = [
    ...seedVideos.map((video) => ({ video, origin: "seed" as const })),
    ...shared.map((video) => ({ video, origin: "shared" as const })),
    ...localVideos.map((video) => ({ video, origin: "local" as const })),
  ].map((it, index) => ({ ...it, index }));

  const display = [...merged].sort(compareForDisplay).slice(0, MAX_PROFILE_VIDEOS);

  // Empty/fallback state — no "Watch the reviews" wall when there's nothing.
  if (display.length === 0) {
    return (
      <section>
        <h2 className="font-display text-lg font-semibold text-cream">Reviews</h2>
        <p className="mt-1 text-sm text-haze">No food videos yet for this spot.</p>
      </section>
    );
  }

  const moreThanShown = merged.length > display.length;

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-lg font-semibold text-cream">
          Watch the reviews
        </h2>
        <p className="text-xs text-haze">
          {display.length} {display.length === 1 ? "clip" : "clips"}
          {moreThanShown ? ` (top ${MAX_PROFILE_VIDEOS} of ${merged.length})` : ""} ·
          previews only, never rehosted
        </p>
      </div>

      {/* Vertical, same-size stack (mobile-first), capped at MAX_PROFILE_VIDEOS. */}
      <div className="flex flex-col gap-3">
        {display.map(({ video, origin }, i) => (
          <div
            key={`${origin}-${video.id}`}
            className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
          >
            <VideoEmbed
              video={video}
              posterEmoji={posters[i % posters.length] ?? "🍽️"}
              fill
            />
            {origin !== "seed" && <OriginBadge origin={origin} />}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-haze">
        Previews link to public sources where available. FoodSwipe never
        downloads, crops, or rehosts third-party video.
      </p>
    </section>
  );
}

function OriginBadge({ origin }: { origin: Exclude<Origin, "seed"> }) {
  const isLocal = origin === "local";
  return (
    <span
      title={
        isLocal
          ? "Saved in this browser only (not shared) — added via the internal demo tool"
          : "Attached via the internal demo tool (shared) — not an auto-discovered source"
      }
      aria-label={
        isLocal ? "Local-only demo clip" : "Demo clip, shared via the admin tool"
      }
      className="absolute right-2 top-2 z-10 rounded-full bg-chili/90 px-2 py-0.5 text-[10px] font-bold text-cream"
    >
      {isLocal ? "Local" : "Demo"}
    </span>
  );
}
