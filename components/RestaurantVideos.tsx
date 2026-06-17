"use client";

import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoHasSource } from "@/lib/video";
import VideoEmbed from "@/components/VideoEmbed";

/**
 * The profile's "Watch the reviews" carousel. Client-side so it can merge the
 * seed clips with any videos a tester attached via `/admin/videos` (localStorage)
 * during this session. Manually-added clips are clearly flagged.
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
  const { videos: manualVideos } = useManualVideos(restaurantId);
  // Map to {video, isManual} so a duplicate id can never flag a seed clip as demo.
  const items = [
    ...seedVideos.map((video) => ({ video, isManual: false })),
    ...manualVideos.map((video) => ({ video, isManual: true })),
  ];
  // Count only clips that actually render an embed or a working link.
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
        {items.map(({ video, isManual }, i) => (
          <div
            key={`${isManual ? "manual" : "seed"}-${video.id}`}
            className="relative aspect-[9/16] w-44 shrink-0 snap-start overflow-hidden rounded-2xl ring-1 ring-white/10"
          >
            <VideoEmbed
              video={video}
              posterEmoji={posters[i % posters.length] ?? "🍽️"}
              fill
            />
            {isManual && (
              <span
                title="Added via the internal demo tool — not a discovered source"
                aria-label="Demo clip: added via the internal demo tool, not a discovered source"
                className="absolute right-2 top-2 z-10 rounded-full bg-pink/90 px-2 py-0.5 text-[10px] font-bold text-ink"
              >
                Demo
              </span>
            )}
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
