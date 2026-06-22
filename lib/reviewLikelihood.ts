/**
 * Internal "review-likelihood" score for imported restaurant candidates.
 *
 * This is NOT a quality, popularity, rating, ranking, trending, or social-proof
 * signal, and it is NEVER shown to users or used by `/feed`. It is an admin-only
 * triage aid that estimates how likely a candidate is to ALREADY have useful
 * short-form social review content out there worth curating — so a human
 * reviewer can work the queue highest-likelihood first.
 *
 * It is a simple, readable, honest weighted score (same spirit as
 * `lib/recommendations.ts`, but a separate concern):
 *   - Review VOLUME (Google `userRatingCount`) is the dominant signal — lots of
 *     reviews ≈ an established place creators are more likely to have covered.
 *   - Google `rating` is ONLY a confidence modifier on that volume, never a
 *     standalone quality score.
 *   - Higher Google result position and having a website each give a slight nudge.
 *   - Duplicates we already have (seed feed / existing candidate) are penalized.
 *
 * The inputs (rating / userRatingCount) are expiring Google-derived metadata and
 * are governed by the candidate's existing sourceFetchedAt / sourceExpiresAt
 * window — re-import after expiry to recompute.
 */

export interface ReviewLikelihoodInput {
  /** Google `userRatingCount` — the dominant signal (review volume). */
  userRatingCount: number | null;
  /** Google `rating` (1–5) — confidence modifier only, never standalone. */
  rating: number | null;
  /** 0-based position in the Google result list. */
  index: number;
  /** Total results being scored together (for position normalization). */
  total: number;
  /** Whether the candidate has a resolved website domain. */
  hasWebsite: boolean;
  /** Matches a live seeded restaurant (already shipping). */
  seedMatch: boolean;
  /** Already imported as a candidate. */
  existingCandidate: boolean;
}

export interface ReviewLikelihood {
  /** Internal triage score, 0–100. */
  score: number;
  /** Human-readable, admin-only explanation of how the score was reached. */
  reasons: string[];
}

// --- weights (kept explicit + honest; tune here, not inline) ---
const VOLUME_WEIGHT = 80; // review volume dominates the score
const VOLUME_REF = 1000; // counts at/above this saturate the volume term
// Rating is a confidence MODIFIER on volume: factor = BASE + (rating - PIVOT) *
// SLOPE, clamped to [BASE, 1]. BASE is both the value at the pivot and the floor
// (so rating can only ever add confidence above the pivot, never subtract below
// BASE) — referencing BASE for the floor keeps the two from drifting apart.
const RATING_FACTOR_BASE = 0.85; // value at the pivot rating, and the floor
const RATING_PIVOT = 3.5; // rating at which the modifier sits at BASE
const RATING_SLOPE = 0.1; // confidence gained per rating point above the pivot
const POSITION_BONUS_MAX = 10; // slight nudge for top Google placement
const WEBSITE_BONUS = 8; // slight nudge for having a website
const SEED_PENALTY = 25; // already in the seed feed
const EXISTING_PENALTY = 15; // already a candidate

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Compute the internal review-likelihood score (0–100) + reasons for a single
 * Google Text Search result. Pure + deterministic given its inputs.
 */
export function scoreReviewLikelihood(input: ReviewLikelihoodInput): ReviewLikelihood {
  const reasons: string[] = [];

  const count =
    typeof input.userRatingCount === "number" && Number.isFinite(input.userRatingCount)
      ? Math.max(0, Math.trunc(input.userRatingCount))
      : 0;
  const rating =
    typeof input.rating === "number" && Number.isFinite(input.rating) ? input.rating : null;

  // 1) Review VOLUME — dominant, log-scaled (counts span 0 .. tens of thousands).
  const volume = count > 0 ? clamp(Math.log10(count + 1) / Math.log10(VOLUME_REF + 1), 0, 1) : 0;

  // 2) Rating as a CONFIDENCE MODIFIER on volume (never a standalone quality score).
  let ratingFactor = 1;
  if (count > 0 && rating !== null) {
    ratingFactor = clamp(
      RATING_FACTOR_BASE + (rating - RATING_PIVOT) * RATING_SLOPE,
      RATING_FACTOR_BASE,
      1,
    );
  }
  const volumePoints = VOLUME_WEIGHT * volume * ratingFactor;

  if (count <= 0) {
    reasons.push("No Google reviews yet — low likelihood of existing social content.");
  } else {
    reasons.push(
      `Google review volume: ${count.toLocaleString("en-US")} rating${count === 1 ? "" : "s"}.`,
    );
    if (rating !== null) {
      reasons.push(
        `Rating ${rating.toFixed(1)} ${ratingFactor >= 1 ? "supports" : "tempers"} confidence (modifier only).`,
      );
    }
  }

  // 3) Slight reward for higher Google result position.
  const span = Math.max(1, input.total - 1);
  const positionBonus =
    input.total > 1
      ? Math.round(POSITION_BONUS_MAX * (1 - clamp(input.index, 0, span) / span))
      : POSITION_BONUS_MAX;
  if (positionBonus > 0) reasons.push(`Appeared high in Google results (#${input.index + 1}).`);

  // 4) Slight reward for a website domain.
  const websiteBonus = input.hasWebsite ? WEBSITE_BONUS : 0;
  if (input.hasWebsite) reasons.push("Has a website domain.");

  // 5) Penalize duplicates we already have.
  let penalty = 0;
  if (input.seedMatch) {
    penalty = SEED_PENALTY;
    reasons.push("Penalty: matches a restaurant already in the seed feed.");
  } else if (input.existingCandidate) {
    penalty = EXISTING_PENALTY;
    reasons.push("Penalty: already imported as a candidate.");
  }

  const score = clamp(Math.round(volumePoints + positionBonus + websiteBonus - penalty), 0, 100);
  return { score, reasons };
}
