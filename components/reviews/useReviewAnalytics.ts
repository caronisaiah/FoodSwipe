"use client";

import {
  analyticsVideoPlatform,
  captureFoodSwipeEvent,
  type AnalyticsVideoPosition,
  type RestaurantAnalyticsContext,
} from "@/lib/analytics";
import type { Video } from "@/lib/types";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";
import { useVisibleOnce } from "@/lib/useVisibleOnce";

function videoContext(
  video: Video,
  position: AnalyticsVideoPosition,
  restaurant: RestaurantAnalyticsContext | undefined,
) {
  if (!restaurant) return null;
  return {
    ...restaurant,
    platform: analyticsVideoPlatform(video.platform),
    videoPosition: position,
    renderMode: videoCanEmbed(video)
      ? ("embed" as const)
      : videoSourceHref(video)
        ? ("source_link" as const)
        : ("unavailable" as const),
  };
}

/** The existing video_impression event, once per review row that stays meaningfully visible. */
export function useReviewImpression<ElementType extends Element>(
  video: Video,
  position: AnalyticsVideoPosition,
  restaurant: RestaurantAnalyticsContext | undefined,
) {
  const context = videoContext(video, position, restaurant);
  return useVisibleOnce<ElementType>(
    () => {
      if (context) captureFoodSwipeEvent("video_impression", context);
    },
    { enabled: context !== null },
  );
}

/** The existing video_source_clicked event for a review's original-post link. */
export function useReviewSourceClick(
  video: Video,
  position: AnalyticsVideoPosition,
  restaurant: RestaurantAnalyticsContext | undefined,
) {
  const context = videoContext(video, position, restaurant);
  return () => {
    if (context) captureFoodSwipeEvent("video_source_clicked", { ...context, sourcePlacement: "review_card" });
  };
}
