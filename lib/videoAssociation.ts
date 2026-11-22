/**
 * Which restaurant a video candidate belongs to — resolved by STABLE ID, never by a typed slug alone.
 *
 * Background: video candidates used to be tied to a restaurant by a free-text `restaurant_slug`. A typo
 * that matched another published slug, a slug that changed at promotion (`semma` -> `semma-2`), or a
 * later restaurant claiming the same slug could attach a video to the WRONG restaurant. The candidate
 * record's id never changes and promotion records `restaurants.source_candidate_id`, so:
 *
 *   - association target  = candidateRestaurantId  (a draft or an already-promoted restaurant), or
 *     restaurantSlug of a published restaurant that has no candidate of origin.
 *   - at attach time the published restaurant is found from the candidate id via source_candidate_id,
 *     so the video follows the restaurant through promotion and any slug change.
 *
 * This module is pure (no DB) so the rules are unit-testable; the DB glue supplies the lookups.
 */
export interface CandidateRef {
  id: string;
  name: string;
  slug: string | null;
  market: string;
  status: string;
}

export interface PublishedRef {
  id: string;
  slug: string;
  name: string;
  market: string;
  status: string;
  sourceCandidateId: string | null;
}

export interface AssociationLookups {
  candidateById(id: string): CandidateRef | null | Promise<CandidateRef | null>;
  publishedBySlug(slug: string): PublishedRef | null | Promise<PublishedRef | null>;
}

export type AssociationResult =
  | {
      ok: true;
      kind: "candidate" | "published" | "none";
      candidateRestaurantId: string | null;
      /** Set only when the target is a published restaurant. */
      restaurantSlug: string | null;
      market: string | null;
    }
  | {
      ok: false;
      code:
        | "unknown_candidate"
        | "unknown_restaurant"
        | "restaurant_not_published"
        | "association_mismatch"
        | "cross_market_association"
        | "invalid_reference";
      field: "candidateRestaurantId" | "restaurantSlug";
      message: string;
    };

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Validate and canonicalize the association supplied on create/PATCH. */
export async function resolveAssociation(
  input: { candidateRestaurantId?: unknown; restaurantSlug?: unknown },
  lookups: AssociationLookups,
): Promise<AssociationResult> {
  if (input.candidateRestaurantId !== undefined && input.candidateRestaurantId !== null && typeof input.candidateRestaurantId !== "string") {
    return { ok: false, code: "invalid_reference", field: "candidateRestaurantId", message: "candidateRestaurantId must be a string." };
  }
  if (input.restaurantSlug !== undefined && input.restaurantSlug !== null && typeof input.restaurantSlug !== "string") {
    return { ok: false, code: "invalid_reference", field: "restaurantSlug", message: "restaurantSlug must be a string." };
  }
  const candidateId = clean(input.candidateRestaurantId);
  const slug = clean(input.restaurantSlug);
  if (!candidateId && !slug) return { ok: true, kind: "none", candidateRestaurantId: null, restaurantSlug: null, market: null };

  const candidate = candidateId ? await lookups.candidateById(candidateId) : null;
  if (candidateId && !candidate) {
    return { ok: false, code: "unknown_candidate", field: "candidateRestaurantId", message: `No restaurant candidate has the id "${candidateId}".` };
  }
  const published = slug ? await lookups.publishedBySlug(slug) : null;
  if (slug && !published) {
    return {
      ok: false, code: "unknown_restaurant", field: "restaurantSlug",
      message: `No published restaurant has the slug "${slug}". Link a draft restaurant by candidateRestaurantId instead.`,
    };
  }

  if (candidate && published) {
    if (candidate.market !== published.market) {
      return {
        ok: false, code: "cross_market_association", field: "restaurantSlug",
        message: `The candidate is in the ${candidate.market} market but "${published.slug}" is in the ${published.market} market.`,
      };
    }
    if (published.sourceCandidateId !== candidate.id) {
      return {
        ok: false, code: "association_mismatch", field: "restaurantSlug",
        message: `"${published.slug}" was not published from candidate "${candidate.name}". Send one reference, or two that refer to the same restaurant.`,
      };
    }
  }

  if (published) {
    if (published.status !== "published") {
      return { ok: false, code: "restaurant_not_published", field: "restaurantSlug", message: `"${published.slug}" is ${published.status}, not published.` };
    }
    // Prefer the stable id whenever the published restaurant came from a candidate.
    return {
      ok: true, kind: "published", restaurantSlug: published.slug, market: published.market,
      candidateRestaurantId: published.sourceCandidateId ?? candidate?.id ?? null,
    };
  }
  return { ok: true, kind: "candidate", candidateRestaurantId: candidate!.id, restaurantSlug: null, market: candidate!.market };
}

export type AttachTargetResult =
  | { ok: true; slug: string; restaurantId: string }
  | { ok: false; code: "target-required" | "restaurant-not-published" | "target-mismatch"; message: string };

/**
 * At attach time: the published restaurant a video candidate points to.
 * An id-linked candidate resolves through `source_candidate_id`, so a changed or reused slug can
 * never redirect the video. If a slug is ALSO stored it must agree.
 */
export async function resolveAttachTarget(
  candidate: { candidateRestaurantId: string | null; restaurantSlug: string | null },
  lookups: {
    publishedBySourceCandidate(candidateId: string): PublishedRef | null | Promise<PublishedRef | null>;
    publishedBySlug(slug: string): PublishedRef | null | Promise<PublishedRef | null>;
  },
): Promise<AttachTargetResult> {
  if (candidate.candidateRestaurantId) {
    const published = await lookups.publishedBySourceCandidate(candidate.candidateRestaurantId);
    if (!published || published.status !== "published") {
      return { ok: false, code: "restaurant-not-published", message: "The linked restaurant has not been published yet." };
    }
    if (candidate.restaurantSlug && candidate.restaurantSlug !== published.slug) {
      return { ok: false, code: "target-mismatch", message: `The stored slug "${candidate.restaurantSlug}" does not match the published restaurant "${published.slug}".` };
    }
    return { ok: true, slug: published.slug, restaurantId: published.id };
  }
  if (candidate.restaurantSlug) {
    const published = await lookups.publishedBySlug(candidate.restaurantSlug);
    if (!published || published.status !== "published") {
      return { ok: false, code: "restaurant-not-published", message: `No published restaurant has the slug "${candidate.restaurantSlug}".` };
    }
    return { ok: true, slug: published.slug, restaurantId: published.id };
  }
  return { ok: false, code: "target-required", message: "This video candidate is not linked to a restaurant." };
}
