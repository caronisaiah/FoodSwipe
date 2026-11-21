"use client";

import { useEffect, useMemo, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";

/** Public profiles show at most this many videos (a DISPLAY rule, not a DB/admin
 * limit - the backend may store more for future ranking/moderation). */
const MAX_PROFILE_VIDEOS = 3;

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
  initialShared = null,
}: {
  restaurantId: string;
  seedVideos: Video[];
  /**
   * The attached videos when the server already read them (the standalone profile does). The reviews are then
   * part of the first paint, so the content below them does not jump when they would otherwise arrive.
   * `null` means unknown and the browser asks the API, as Swipe's card does.
   */
  initialShared?: Video[] | null;
}): ProfileVideosResult {
  const { videos: localVideos } = useManualVideos(restaurantId);
  const [sharedState, setSharedState] = useState<{
    restaurantId: string;
    videos: Video[];
  } | null>(null);
  const fetched =
    sharedState?.restaurantId === restaurantId ? sharedState.videos : null;
  const shared = initialShared ?? fetched;

  useEffect(() => {
    if (initialShared) return;
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
  }, [restaurantId, initialShared]);

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
