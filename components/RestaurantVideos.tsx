"use client";

import { useEffect, useMemo, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import {
  hasUrl,
  sourceLinkLabel,
  videoCanEmbed,
  videoSourceHref,
} from "@/lib/video";
import MaterialIcon from "@/components/MaterialIcon";
import VideoEmbed from "@/components/VideoEmbed";

/** Public profiles show at most this many videos (a DISPLAY rule, not a DB/admin
 * limit - the backend may store more for future ranking/moderation). */
const MAX_PROFILE_VIDEOS = 3;

const CLIP_PLACEHOLDER_BG =
  "radial-gradient(120% 80% at 30% 18%, #6b431a 0%, transparent 55%), radial-gradient(110% 90% at 82% 88%, #5a1633 0%, transparent 55%), linear-gradient(160deg,#2a2012 0%,#1a1622 55%,#0e0e12 100%)";

type Origin = "seed" | "shared" | "local";

interface Item {
  video: Video;
  origin: Origin;
  index: number;
}

export interface ProfileVideoItem {
  video: Video;
  origin: Origin;
}

export interface ProfileVideosResult {
  videos: ProfileVideoItem[];
  mergedCount: number;
  moreThanShown: boolean;
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

function isUsableProfileVideo(v: Video): boolean {
  if (v.sourceType === "placeholder" || v.legalDisplayStatus === "placeholder-only") {
    return false;
  }
  return videoCanEmbed(v) || videoSourceHref(v) !== undefined || v.legalDisplayStatus === "unavailable";
}

/**
 * Deterministic, transparent display order (NOT the feed ranking engine):
 * real-post -> embeddable/source-link -> richer metadata -> newer -> original.
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

  return a.index - b.index;
}

export function useRestaurantProfileVideos({
  restaurantId,
  seedVideos,
}: {
  restaurantId: string;
  seedVideos: Video[];
}): ProfileVideosResult {
  const { videos: localVideos } = useManualVideos(restaurantId);
  const [sharedState, setSharedState] = useState<{
    restaurantId: string;
    videos: Video[];
  } | null>(null);
  const shared =
    sharedState?.restaurantId === restaurantId ? sharedState.videos : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${restaurantId}/videos`);
        const data = (await res.json()) as { videos?: Video[] };
        if (!cancelled) {
          setSharedState({
            restaurantId,
            videos: Array.isArray(data.videos) ? data.videos : [],
          });
        }
      } catch {
        if (!cancelled) setSharedState({ restaurantId, videos: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return useMemo(() => {
    const sharedVideos = shared ?? [];
    const attached: Item[] = [
      ...sharedVideos.map((video) => ({ video, origin: "shared" as const })),
      ...localVideos.map((video) => ({ video, origin: "local" as const })),
    ].map((it, index) => ({ ...it, index }));
    const seed: Item[] = seedVideos
      .map((video) => ({ video, origin: "seed" as const }))
      .map((it, index) => ({ ...it, index }));
    const usableAttached = attached.filter((item) => isUsableProfileVideo(item.video));
    const usableSeed = seed.filter((item) => isUsableProfileVideo(item.video));
    const pool =
      usableAttached.length > 0
        ? usableAttached
        : shared === null && localVideos.length === 0
          ? []
          : usableSeed;

    const videos = [...pool]
      .sort(compareForDisplay)
      .slice(0, MAX_PROFILE_VIDEOS)
      .map(({ video, origin }) => ({ video, origin }));

    return {
      videos,
      mergedCount: pool.length,
      moreThanShown: pool.length > videos.length,
    };
  }, [localVideos, seedVideos, shared]);
}

export function firstReviewHref(videos: Video[]): string | undefined {
  return videos.map(videoSourceHref).find((href): href is string => Boolean(href));
}

/**
 * Large Hinge-style review asset. Legal display rules still come from lib/video:
 * embeddable clips mount the official iframe lazily; link-only clips become
 * outbound poster cards; blocked states stay honest and non-linkable.
 */
export function ReviewClipCard({
  item,
  posterEmoji,
  featured = false,
}: {
  item: ProfileVideoItem;
  posterEmoji: string;
  featured?: boolean;
}) {
  const { video, origin } = item;
  const canEmbed = videoCanEmbed(video);
  const sourceHref = videoSourceHref(video);

  return (
    <article className="relative">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[24px] bg-ink ring-1 ring-inset ring-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.42)]">
        {canEmbed ? (
          <VideoEmbed video={video} posterEmoji={posterEmoji} fill />
        ) : sourceHref ? (
          <SourceLinkCard video={video} href={sourceHref} posterEmoji={posterEmoji} />
        ) : (
          <PreviewOnlyCard video={video} posterEmoji={posterEmoji} />
        )}
        {origin !== "seed" && <OriginBadge origin={origin} />}
        {featured && (
          <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-full bg-saffron/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-saffron-ink shadow-lg shadow-black/25">
            Featured
          </span>
        )}
      </div>
    </article>
  );
}

function SourceLinkCard({
  video,
  href,
  posterEmoji,
}: {
  video: Video;
  href: string;
  posterEmoji: string;
}) {
  const content = <PosterFrame video={video} posterEmoji={posterEmoji} href={href} />;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${sourceLinkLabel(video)} for ${video.attributionText}`}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute inset-0 block text-cream"
    >
      {content}
    </a>
  );
}

function PreviewOnlyCard({
  video,
  posterEmoji,
}: {
  video: Video;
  posterEmoji: string;
}) {
  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <PosterFrame video={video} posterEmoji={posterEmoji} />
    </div>
  );
}

function PosterFrame({
  video,
  posterEmoji,
  href,
}: {
  video: Video;
  posterEmoji: string;
  href?: string;
}) {
  const background = hasUrl(video.thumbnailUrl)
    ? `center/cover no-repeat url("${video.thumbnailUrl}")`
    : CLIP_PLACEHOLDER_BG;
  const creator = video.creatorDisplayName;

  return (
    <>
      <div className="absolute inset-0" style={{ background }} aria-hidden />
      {!hasUrl(video.thumbnailUrl) && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="text-7xl opacity-35 drop-shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
            {posterEmoji}
          </span>
        </div>
      )}
      <div
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_26%,transparent_44%,rgba(0,0,0,0.88)_100%)]"
        aria-hidden
      />
      <span className="absolute left-3 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.10em] text-white/90 backdrop-blur-md ring-1 ring-white/10">
        {video.platform}
      </span>
      <span
        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pb-[72px]"
        aria-hidden
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md ring-1 ring-white/30">
          <MaterialIcon name="play_arrow" filled className="text-[30px]" />
        </span>
      </span>
      <div className="absolute inset-x-3.5 bottom-3.5 z-10">
        <p className="truncate text-xs font-bold text-saffron">
          {video.creatorHandle}
          {creator && creator !== video.creatorHandle && (
            <span className="font-medium text-white/65"> · {creator}</span>
          )}
        </p>
        <p className="mt-1 line-clamp-3 text-base font-semibold leading-[1.35] text-white/95 drop-shadow">
          {video.caption}
        </p>
        {href ? (
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-bold text-cream backdrop-blur-md ring-1 ring-white/25">
            Watch on {video.platform}
            <MaterialIcon name="arrow_outward" className="text-[15px]" />
          </span>
        ) : (
          <p className="mt-2 text-[10.5px] leading-relaxed text-white/55">
            {blockedVideoLabel(video)}
          </p>
        )}
      </div>
    </>
  );
}

function blockedVideoLabel(video: Video): string {
  if (video.legalDisplayStatus === "unavailable") return "Source unavailable";
  if (video.legalDisplayStatus === "placeholder-only" || video.sourceType === "placeholder") {
    return "Preview only - source placeholder";
  }
  return `Preview only - open ${video.platform} to watch`;
}

function OriginBadge({ origin }: { origin: Exclude<Origin, "seed"> }) {
  const isLocal = origin === "local";
  return (
    <span
      title={
        isLocal
          ? "Saved in this browser only (not shared) - added via the internal demo tool"
          : "Attached via the internal demo tool (shared) - not an auto-discovered source"
      }
      aria-label={isLocal ? "Local-only demo clip" : "Demo clip, shared via the admin tool"}
      className="absolute right-3 top-12 z-20 rounded-full bg-chili/90 px-2 py-0.5 text-[10px] font-bold text-cream"
    >
      {isLocal ? "Local" : "Demo"}
    </span>
  );
}

export default function RestaurantVideos({
  restaurantId,
  seedVideos,
  posters,
}: {
  restaurantId: string;
  seedVideos: Video[];
  posters: string[];
}) {
  const { videos } = useRestaurantProfileVideos({
    restaurantId,
    seedVideos,
  });

  if (videos.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-haze">
          Watch the reviews
        </h2>
      </div>
      <div className="grid gap-3">
        {videos.map((item, i) => (
          <ReviewClipCard
            key={`${item.origin}-${item.video.id}`}
            item={item}
            posterEmoji={posters[i % posters.length] ?? ""}
            featured={i === 0}
          />
        ))}
      </div>
    </section>
  );
}
