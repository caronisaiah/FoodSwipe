/**
 * Core domain types for FoodSwipe.
 *
 * These are intentionally framework-agnostic so the same shapes can back a
 * real database + ingestion pipeline later. Today they're satisfied by the
 * local seed data in `lib/seed`.
 */

/** Where a piece of review content originated. */
export type Platform = "TikTok" | "Instagram" | "YouTube" | "Web";

/** Price tier, 1 ($) … 4 ($$$$). Numeric so budget math stays simple. */
export type PriceLevel = 1 | 2 | 3 | 4;

/** Controlled vocab for the onboarding "cravings" picker. */
export type Craving =
  | "burgers"
  | "sushi"
  | "tacos"
  | "pasta"
  | "soul food"
  | "ramen"
  | "coffee"
  | "dessert"
  | "mediterranean"
  | "halal"
  | "vegan";

/**
 * Cuisine tags on a restaurant. Superset of `Craving` (so every craving can
 * match a tag) plus display-only cuisines. Typing this — rather than `string[]`
 * — catches vocab typos in the seed data at compile time.
 */
export type Cuisine =
  | Craving
  | "filipino"
  | "asian"
  | "dinner"
  | "middle eastern"
  | "french"
  | "brunch"
  | "american"
  | "new american"
  | "italian"
  | "japanese"
  | "noodles"
  | "southern"
  | "diner"
  | "mexican"
  | "street food"
  | "bar food"
  | "british"
  | "omakase"
  | "cafe"
  | "bakery"
  | "vegetarian"
  | "persian"
  | "kebab"
  | "ice cream"
  // v1.5.1 launch-demo seed additions
  | "indian"
  | "korean"
  | "ethiopian"
  | "laotian"
  | "seafood"
  | "pizza"
  | "bagels";

/** Controlled vocab for vibe / occasion tags. */
export type Vibe =
  | "quick bite"
  | "date night"
  | "group dinner"
  | "late night"
  | "aesthetic"
  | "hidden gem"
  | "casual";

/** Controlled vocab for dietary needs. */
export type Dietary =
  | "vegetarian"
  | "vegan"
  | "halal"
  | "gluten-free"
  | "no pork";

/**
 * How a video reference came to exist. Honesty matters: we never imply a
 * placeholder is a real post.
 *  - real-post        a specific, real public post.
 *  - creator-profile  a real creator/channel/search where reviews live (not one post).
 *  - placeholder      illustrative only — no real source behind it.
 *  - manual-seed      hand-added (seed or the admin demo tool) for prototyping.
 */
export type VideoSourceType =
  | "real-post"
  | "creator-profile"
  | "placeholder"
  | "manual-seed";

/** How confident we are that this video is actually about this restaurant. */
export type MatchConfidence = "high" | "medium" | "low" | "manual";

/**
 * What we're legally/technically allowed to show — drives VideoEmbed.
 *  - embeddable        render the official embed (needs embedUrl).
 *  - source-link-only  preview + a real "view source" link, no embed.
 *  - placeholder-only  preview only, NO external link (nothing real to point to).
 *  - unavailable       source is gone/blocked; show a muted, honest state.
 */
export type LegalDisplayStatus =
  | "embeddable"
  | "source-link-only"
  | "placeholder-only"
  | "unavailable";

/** A single external short-form review video (never rehosted — see VideoEmbed). */
export interface Video {
  id: string;
  platform: Platform;
  /**
   * Public URL to view the source (a post, profile, or discovery search).
   * Optional: placeholder-only clips have no real source, so requiring a URL
   * would invite fake/meaningless values. See `lib/video.ts` for gating.
   */
  sourceUrl?: string;
  /** Optional embeddable URL (allowlisted in lib/video). Absent -> no embed. */
  embedUrl?: string;
  creatorHandle: string;
  /** Optional friendly creator name shown alongside the handle. */
  creatorDisplayName?: string;
  caption: string;
  /** Optional preview image; component falls back to a styled placeholder. */
  thumbnailUrl?: string;
  /** Human-readable credit, e.g. "Video by @handle on TikTok". */
  attributionText: string;
  /** ISO date the original content was published, if known. */
  publishedAt?: string;
  /** ISO date FoodSwipe discovered/attached this reference, if known. */
  discoveredAt?: string;
  /** True only for genuinely real sources — never for placeholders. */
  isRealSource: boolean;
  sourceType: VideoSourceType;
  matchConfidence: MatchConfidence;
  legalDisplayStatus: LegalDisplayStatus;
}

/**
 * A video manually attached to a restaurant via the internal admin/demo tool.
 * Persisted in localStorage (no server db in v1) and merged onto profiles.
 */
export interface ManualVideoEntry {
  restaurantId: string;
  video: Video;
}

/** A restaurant profile aggregated from public review content. */
export interface Restaurant {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  /**
   * Optional Google Place ID — the ONLY Google datum we ever store long-term
   * (Google's policy explicitly permits caching Place IDs indefinitely). When
   * set, the profile hero shows a real Google Place Photo, fetched fresh
   * server-side and never downloaded/stored/rehosted. Absent -> the hero falls
   * back to the existing video-style placeholder. See `lib/places.ts`.
   */
  googlePlaceId?: string;
  /**
   * Optional official website domain (bare host, e.g. "rosesluxury.com"). When
   * set and no Google Place Photo is available, the profile hero shows the
   * restaurant's brand logo (via Logo.dev) instead of the generic placeholder —
   * loaded directly from the provider's CDN, never downloaded/stored/rehosted.
   * See `lib/logos.ts`.
   */
  websiteDomain?: string;
  /** Placeholder coordinates — not used for real distance yet. */
  lat: number;
  lng: number;
  /** Static placeholder distance from the default DC location. */
  distanceMiles: number;
  priceLevel: PriceLevel;
  cuisineTags: Cuisine[];
  dietaryTags: Dietary[];
  vibeTags: Vibe[];
  dishHighlights: string[];
  /** Occasions this place is great for, drawn from the vibe vocab. */
  bestFor: Vibe[];
  /** Short, human "why you might like this" blurb. */
  reasonText: string;

  // --- Seeded social-proof metrics (0–100 unless noted) ---
  trendScore: number;
  vibeScore: number;
  videoCount: number;
  recentVideoCount: number;
  saveCount: number;

  /** At least one source clip — the hero. Non-empty tuple so `videos[0]` is safe. */
  videos: [Video, ...Video[]];
}

/**
 * A restaurant identity photo resolved from Google Places (New) at request time.
 * Ephemeral by contract: `photoUri` is a short-lived Google URL that is NEVER
 * downloaded, stored, or rehosted (see `lib/places.ts`). `attributions` MUST be
 * displayed wherever the photo is shown (Google Places policy).
 */
export interface PlacePhoto {
  /** Ephemeral googleusercontent image URL (contains no API key). Do NOT persist. */
  photoUri: string;
  /** Required photo author attribution(s): a display name and an optional link. */
  attributions: { displayName: string; uri?: string }[];
}

/** User-selected discovery preferences captured during onboarding. */
export interface UserPreferences {
  /** Free-text neighborhood / city label. Defaults to "Washington, DC". */
  location: string;
  /** Max distance willing to travel, in miles. */
  maxDistanceMiles: 1 | 3 | 5 | 10;
  /** Highest price tier the user is comfortable with. */
  budget: PriceLevel;
  cravings: Craving[];
  vibes: Vibe[];
  dietary: Dietary[];
}

export type SwipeDirection = "left" | "right";

/** A recorded user decision on a card. Right = save, left = skip. */
export interface SwipeAction {
  restaurantId: string;
  direction: SwipeDirection;
  /** Epoch ms when the swipe happened. */
  at: number;
}

/** Output of the ranking function: a restaurant plus why it surfaced. */
export interface ScoredRestaurant {
  restaurant: Restaurant;
  score: number;
  /** Plain-language reasons that fed the score (used in the UI). */
  matchReasons: string[];
}
