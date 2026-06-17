"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoHasSource } from "@/lib/video";
import VideoEmbed from "@/components/VideoEmbed";

type Origin = "seed" | "shared" | "local";

/**
 * The profile's "Watch the reviews" carousel. Merges three sources, all read-only
 * here and never rehosted:
 *  - seed   : the hand-authored clips shipped in the repo
 *  - shared : videos attached via /admin/videos, persisted in the backend (v1.2)
 *  - local  : legacy per-browser localStorage demo clips (fallback, labeled)
 * The shared fetch is best-effort: if the API/DB is unavailable the seed (and
 * any local) clips still render — the profile never breaks.
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

  const items: { video: Video; origin: Origin }[] = [
    ...seedVideos.map((video) => ({ video, origin: "seed" as const })),
    ...shared.map((video) => ({ video, origin: "shared" as const })),
    ...localVideos.map((video) => ({ video, origin: "local" as const })),
  ];
  const linkable = items.filter((it) => videoHasSource(it.video)).length;

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-lg font-semibold text-cream">
          Watch the reviews
        </h2>
        <p className="text-xs text-haze">
          {items.length} {items.length === 1 ? "source" : "sources"}
          {linkable > 0 ? ` · ${linkable} with a working link` : ""} · previews
          only, never rehosted
        </p>
      </div>

      <div
        role="group"
        aria-label="Review clips — scroll horizontally"
        tabIndex={0}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1"
      >
        {items.map(({ video, origin }, i) => (
          <div
            key={`${origin}-${video.id}`}
            className="relative aspect-[9/16] w-44 shrink-0 snap-start overflow-hidden rounded-2xl ring-1 ring-white/10"
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
      className="absolute right-2 top-2 z-10 rounded-full bg-pink/90 px-2 py-0.5 text-[10px] font-bold text-ink"
    >
      {isLocal ? "Local" : "Demo"}
    </span>
  );
}
