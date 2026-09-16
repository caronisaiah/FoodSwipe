"use client";

import posthog from "posthog-js";
import type {
  Cuisine,
  Platform,
  PriceLevel,
  Restaurant,
  Vibe,
} from "@/lib/types";
import type { Market } from "@/lib/markets";

export type AnalyticsSurface = "feed" | "standalone_profile" | "saved";
export type AnalyticsVideoPlatform = "tiktok" | "instagram" | "youtube" | "web";
export type AnalyticsVideoRenderMode = "embed" | "source_link" | "unavailable";
export type AnalyticsVideoPosition = 1 | 2 | 3;

export interface RestaurantAnalyticsContext {
  restaurantId: string;
  market: Market;
  surface: AnalyticsSurface;
  feedPosition?: number;
  priceLevel: PriceLevel;
  cuisineTags: Cuisine[];
  vibeTags: Vibe[];
  videoCount: number;
}

type VideoAnalyticsContext = RestaurantAnalyticsContext & {
  platform: AnalyticsVideoPlatform;
  videoPosition: AnalyticsVideoPosition;
  renderMode: AnalyticsVideoRenderMode;
};

interface FoodSwipeEventProperties {
  foodswipe_feed_started: {
    market: Market | "unknown";
    restaurantCount: number;
    startReason: "entry" | "restart";
  };
  restaurant_impression: RestaurantAnalyticsContext & { feedPosition: number };
  restaurant_swiped: RestaurantAnalyticsContext & {
    direction: "left" | "right";
  };
  restaurant_saved: RestaurantAnalyticsContext & {
    saveSource: "swipe" | "profile_button";
  };
  restaurant_unsaved: RestaurantAnalyticsContext & {
    unsaveSource: "profile_button" | "saved_list";
  };
  profile_engaged: RestaurantAnalyticsContext;
  profile_depth_reached: RestaurantAnalyticsContext & {
    milestone: "why_like" | "what_to_order" | "go_there";
  };
  video_impression: VideoAnalyticsContext;
  video_source_clicked: VideoAnalyticsContext & {
    sourcePlacement: "review_card";
  };
  directions_clicked: RestaurantAnalyticsContext;
  website_clicked: RestaurantAnalyticsContext;
  reviews_clicked: RestaurantAnalyticsContext;
  restaurant_shared: RestaurantAnalyticsContext & {
    method: "native" | "clipboard";
  };
}

export type FoodSwipeEventName = keyof FoodSwipeEventProperties;

let initialized = false;

function analyticsConfiguration(): {
  token: string;
  host: string;
  environment: string;
} | null {
  if (process.env.NEXT_PUBLIC_FOODSWIPE_ANALYTICS_ENABLED !== "true") {
    return null;
  }

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  const environment = process.env.NEXT_PUBLIC_FOODSWIPE_ANALYTICS_ENV?.trim();
  if (!token || !host || !environment) return null;

  return { token, host, environment };
}

export function initializeFoodSwipeAnalytics(): void {
  const config = analyticsConfiguration();
  if (!config || initialized) return;

  try {
    posthog.init(config.token, {
      api_host: config.host,
      defaults: "2026-05-30",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_heatmaps: false,
      rageclick: false,
      disable_session_recording: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      persistence: "localStorage",
      save_referrer: false,
      save_campaign_params: false,
      property_denylist: [
        "$current_url",
        "$initial_current_url",
        "$session_entry_url",
        "$referrer",
        "$initial_referrer",
      ],
    });
    initialized = true;
  } catch {
    // Analytics must never affect product behavior.
  }
}

export function captureFoodSwipeEvent<EventName extends FoodSwipeEventName>(
  event: EventName,
  properties: FoodSwipeEventProperties[EventName],
): void {
  const config = analyticsConfiguration();
  if (!config || !initialized) return;

  try {
    posthog.capture(event, {
      ...properties,
      analyticsEnvironment: config.environment,
    });
  } catch {
    // Analytics must never affect product behavior.
  }
}

export function restaurantAnalyticsContext(
  restaurant: Restaurant,
  surface: AnalyticsSurface,
  feedPosition?: number,
): RestaurantAnalyticsContext {
  return {
    restaurantId: restaurant.id,
    market: restaurant.market,
    surface,
    ...(feedPosition === undefined ? {} : { feedPosition }),
    priceLevel: restaurant.priceLevel,
    cuisineTags: [...restaurant.cuisineTags],
    vibeTags: [...restaurant.vibeTags],
    videoCount: restaurant.videoCount,
  };
}

export function analyticsVideoPlatform(platform: Platform): AnalyticsVideoPlatform {
  return platform.toLowerCase() as AnalyticsVideoPlatform;
}
