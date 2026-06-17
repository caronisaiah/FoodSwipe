import type {
  Restaurant,
  ScoredRestaurant,
  UserPreferences,
} from "./types";
import { priceLabel } from "./options";
import { videoHasSource } from "./video";

/**
 * Lightweight, transparent ranking for the swipe feed.
 *
 * This is deliberately a simple weighted sum — NOT a learned model — so the
 * "why this matched" explanation is always honest. Every factor the prompt
 * called for is here: craving, budget, vibe, dietary, distance, trend, and
 * exclusion of things the user already swiped on.
 *
 * The only hard filter is "already swiped" (skip OR save) — everything else is
 * a soft score, so the feed is always ranked best-first and never empties out.
 */

// Tunable weights. Kept together so the scoring is easy to reason about.
const W = {
  cravingPerMatch: 28,
  vibePerMatch: 14,
  bestForBonus: 10,
  budgetWithin: 12,
  budgetOverPerTier: 18, // penalty per price tier above budget
  dietarySatisfied: 16, // per dietary need the place clearly supports
  // A missing dietary tag means "unconfirmed", not "violates" — so keep the
  // penalty smaller than the reward (a partial match still nets positive).
  dietaryUnmet: 8,
  withinDistance: 16,
  overDistancePerMile: 9, // penalty per mile beyond the user's max
  closenessBonus: 8, // extra for being very close (scaled by proximity)
  trend: 14, // × trendScore/100
  vibeScore: 8, // × vibeScore/100
  freshness: 6, // × recentVideoCount/10 (capped)
  videoCoverage: 8, // more attached source clips
  videoQuality: 6, // share of clips that are real / linkable (not pure placeholders)
} as const;

interface Factor {
  /** Signed contribution to the score. */
  points: number;
  /** Human-readable reason, shown only for meaningful positive matches. */
  reason?: string;
}

function craving(r: Restaurant, prefs: UserPreferences): Factor {
  if (prefs.cravings.length === 0) return { points: 0 };
  const tags = new Set(r.cuisineTags.map((t) => t.toLowerCase()));
  const hits = prefs.cravings.filter((c) => tags.has(c.toLowerCase()));
  if (hits.length === 0) return { points: 0 };
  return {
    points: hits.length * W.cravingPerMatch,
    reason: `Matches your craving for ${hits.join(" & ")}`,
  };
}

function vibe(r: Restaurant, prefs: UserPreferences): Factor {
  if (prefs.vibes.length === 0) return { points: 0 };
  const vibeTags = new Set(r.vibeTags);
  const hits = prefs.vibes.filter((v) => vibeTags.has(v));
  if (hits.length === 0) return { points: 0 };
  // Extra credit when the place is explicitly "best for" a vibe they picked.
  const bestForHits = prefs.vibes.filter((v) => r.bestFor.includes(v));
  return {
    points: hits.length * W.vibePerMatch + bestForHits.length * W.bestForBonus,
    reason: `Great for ${hits.join(" & ")}`,
  };
}

function budget(r: Restaurant, prefs: UserPreferences): Factor {
  if (r.priceLevel <= prefs.budget) {
    return {
      points: W.budgetWithin,
      reason: `In your ${priceLabel(prefs.budget)} budget`,
    };
  }
  const over = r.priceLevel - prefs.budget;
  return { points: -over * W.budgetOverPerTier };
}

function dietary(r: Restaurant, prefs: UserPreferences): Factor {
  if (prefs.dietary.length === 0) return { points: 0 };
  const supported = new Set(r.dietaryTags);
  const met = prefs.dietary.filter((d) => supported.has(d));
  const unmet = prefs.dietary.length - met.length;
  const points = met.length * W.dietarySatisfied - unmet * W.dietaryUnmet;
  return {
    points,
    reason: met.length > 0 ? `${met.join(" & ")}-friendly` : undefined,
  };
}

function distance(r: Restaurant, prefs: UserPreferences): Factor {
  if (r.distanceMiles <= prefs.maxDistanceMiles) {
    // Closer is better: full closeness bonus at 0 mi, fading to 0 at the max.
    const proximity = 1 - r.distanceMiles / prefs.maxDistanceMiles;
    // No reason string — the card already shows the mileage in its meta row.
    return { points: W.withinDistance + proximity * W.closenessBonus };
  }
  const over = r.distanceMiles - prefs.maxDistanceMiles;
  return { points: -over * W.overDistancePerMile };
}

function popularity(r: Restaurant): Factor {
  const points =
    (r.trendScore / 100) * W.trend +
    (r.vibeScore / 100) * W.vibeScore +
    (Math.min(r.recentVideoCount, 10) / 10) * W.freshness;
  // No reason string — the card surfaces trend via its always-visible badge,
  // so we don't waste a match-reason chip restating it.
  return { points };
}

/**
 * A small nudge toward restaurants with stronger, more credible video coverage:
 * more attached clips, and a higher share of real/linkable (non-placeholder)
 * sources. Deliberately low-weight — it tilts ties, it doesn't dominate.
 */
function videoStrength(r: Restaurant): Factor {
  const vids = r.videos;
  const coverage = Math.min(vids.length, 4) / 4;
  // Only genuinely sourced clips count toward "quality" — placeholder-only /
  // unavailable never do, even if other fields are inconsistent (videoHasSource
  // applies the same legal-safe gating the UI uses).
  const credible = vids.filter(videoHasSource).length;
  const quality = vids.length ? credible / vids.length : 0;
  return { points: coverage * W.videoCoverage + quality * W.videoQuality };
}

/** Score one restaurant against the user's preferences. */
export function scoreRestaurant(
  r: Restaurant,
  prefs: UserPreferences,
): ScoredRestaurant {
  const factors = [
    craving(r, prefs),
    vibe(r, prefs),
    budget(r, prefs),
    dietary(r, prefs),
    distance(r, prefs),
    popularity(r),
    videoStrength(r),
  ];
  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const matchReasons = factors
    .filter((f) => f.reason && f.points > 0)
    .map((f) => f.reason as string);
  return { restaurant: r, score, matchReasons };
}

/**
 * Rank the feed: score everything, drop anything already swiped, sort best
 * first. Ties broken by trend then save count for a stable, sensible order.
 */
export function rankRestaurants(
  restaurants: Restaurant[],
  prefs: UserPreferences,
  swipedIds: Iterable<string> = [],
): ScoredRestaurant[] {
  const excluded = new Set(swipedIds);
  return restaurants
    .filter((r) => !excluded.has(r.id))
    .map((r) => scoreRestaurant(r, prefs))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.restaurant.trendScore - a.restaurant.trendScore ||
        b.restaurant.saveCount - a.restaurant.saveCount,
    );
}
