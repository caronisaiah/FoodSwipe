import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { searchPlacesText, type PlaceTextResult } from "@/lib/places";
import {
  addRestaurantSource,
  createIngestionJob,
  getCandidateByGooglePlaceId,
  getExistingCandidatePlaceStatuses,
  getExistingCandidateSlugs,
  insertCandidateRestaurant,
  isDbConfigured,
  slugify,
  type CandidateRestaurant,
} from "@/lib/db/candidates";
import { scoreReviewLikelihood, type ReviewLikelihood } from "@/lib/reviewLikelihood";
import { suggestCandidateTags } from "@/lib/candidateTagger";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import { DEFAULT_MARKET, isAllowedMarket, type Market } from "@/lib/markets";

/*
  POST /api/admin/restaurants/candidates/import/google  (INTERNAL, admin-secret)

  Phase 2 restaurant automation — Google Places API (New) Text Search → candidate
  REVIEW rows. NOTHING is published to /feed; imported rows land as
  status="needs_review", source="google_places", for a human to curate/approve.

  Body: { query: string, maxResults?: number (1-20, default 10), dryRun?: boolean }
  dryRun DEFAULTS TO true (must pass `"dryRun": false` to actually write).

  Guards mirror the other admin routes:
    503 if FOODSWIPE_ADMIN_SECRET unset · 401 if header missing/wrong ·
    503 if DATABASE_URL unset · 503 if GOOGLE_MAPS_API_KEY unset · 400 if no query.
*/

// Live seed restaurants — used ONLY to warn when a Google result looks like a
// restaurant we already ship. Never a hard blocker, never compared as popularity.
const SEED_PLACE_IDS = new Set(
  RESTAURANTS.map((r) => r.googlePlaceId).filter((x): x is string => Boolean(x)),
);
const SEED_NAMES = new Set(RESTAURANTS.map((r) => r.name.toLowerCase()));

// Google permits caching Place IDs indefinitely, but other Place content should
// be refreshed. Imported candidate metadata gets a 30-day freshness window.
const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function hostFrom(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Map Google's price enum to FoodSwipe 1–4 only when clean; otherwise null. */
function mapPrice(level: string | null): number | null {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return 1;
    case "PRICE_LEVEL_MODERATE":
      return 2;
    case "PRICE_LEVEL_EXPENSIVE":
      return 3;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 4;
    default:
      return null; // FREE / UNSPECIFIED / unknown -> leave for human review
  }
}

function uniqueSlug(base: string, used: Set<string>): string {
  const root = base || "restaurant";
  if (!used.has(root)) return root;
  let i = 2;
  while (used.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

function seedWarning(r: PlaceTextResult): string | null {
  if (r.placeId && SEED_PLACE_IDS.has(r.placeId)) {
    return "Matches a live seeded restaurant by Google Place ID.";
  }
  if (r.displayName && SEED_NAMES.has(r.displayName.toLowerCase())) {
    return "Name matches a live seeded restaurant.";
  }
  return null;
}

/** Build the candidate body for a Google result, with conservative auto-suggested
 *  tags as a STARTING POINT for human review (never published). */
function toCandidateInput(
  r: PlaceTextResult,
  query: string,
  slug: string,
  fetchedAt: Date,
  expiresAt: Date,
  likelihood: ReviewLikelihood,
  market: Market,
) {
  const warning = seedWarning(r);
  const priceLevel = mapPrice(r.googlePriceLevel);

  // Deterministic, conservative tag suggestions (controlled vocab only).
  const suggestion = suggestCandidateTags({
    name: r.displayName,
    primaryType: r.primaryType,
    types: r.types,
    priceLevel,
    query,
    websiteDomain: hostFrom(r.websiteUri),
    reviewLikelihoodScore: likelihood.score,
  });

  const reviewNotes =
    `Imported via Google Places Text Search query: "${query}". ` +
    `Suggested tags need human review (confidence: ${suggestion.suggestionConfidence}). ` +
    `Google primaryType: ${r.primaryType ?? "n/a"}. ` +
    `Google-derived candidate metadata should be reviewed/refreshed before ` +
    `expiry (${expiresAt.toISOString().slice(0, 10)}).` +
    (warning ? ` WARNING: ${warning}` : "");

  // Snapshot of the suggestion, so the review console can diff human edits and
  // offer "reset to suggestions".
  const suggestedTags = {
    cuisineTags: suggestion.cuisineTags,
    dietaryTags: suggestion.dietaryTags,
    vibeTags: suggestion.vibeTags,
    bestFor: suggestion.bestFor,
    dishHighlights: suggestion.dishHighlights,
    reasonText: suggestion.reasonText,
  };

  return {
    name: r.displayName,
    slug,
    status: "needs_review",
    source: "google_places",
    market,
    googlePlaceId: r.placeId,
    websiteDomain: hostFrom(r.websiteUri),
    address: r.formattedAddress,
    neighborhood: null,
    lat: r.lat,
    lng: r.lng,
    priceLevel,
    // Suggested tags (controlled vocab) — a starting point for review, not truth.
    cuisineTags: suggestion.cuisineTags,
    dietaryTags: suggestion.dietaryTags,
    vibeTags: suggestion.vibeTags,
    dishHighlights: suggestion.dishHighlights,
    bestFor: suggestion.bestFor,
    reasonText: suggestion.reasonText,
    reviewNotes,
    // Freshness window for the Google-derived metadata (refresh before expiry).
    sourceFetchedAt: fetchedAt,
    sourceExpiresAt: expiresAt,
    // INTERNAL admin-triage score — never public, never in /feed.
    reviewLikelihoodScore: likelihood.score,
    reviewLikelihoodReasons: likelihood.reasons,
    // Auto-suggestion provenance for the review console.
    suggestionConfidence: suggestion.suggestionConfidence,
    suggestionReasons: suggestion.suggestionReasons,
    suggestedTags,
    seedMatchWarning: warning,
  };
}

/**
 * Score every usable result for INTERNAL review-likelihood and return them
 * sorted highest-first. Position bonus uses the original Google order (index);
 * `seedMatch`/`existingCandidate` drive the duplicate penalty.
 */
function scoreAndRank(
  usable: PlaceTextResult[],
  existingPlaceIds: Set<string>,
): { r: PlaceTextResult; likelihood: ReviewLikelihood }[] {
  const total = usable.length;
  return usable
    .map((r, index) => ({
      r,
      likelihood: scoreReviewLikelihood({
        userRatingCount: r.userRatingCount,
        rating: r.rating,
        index,
        total,
        hasWebsite: hostFrom(r.websiteUri) !== null,
        seedMatch: seedWarning(r) !== null,
        existingCandidate: r.placeId ? existingPlaceIds.has(r.placeId) : false,
      }),
    }))
    .sort((a, b) => b.likelihood.score - a.likelihood.score);
}

export async function POST(req: Request): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503 },
    );
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return Response.json(
      { error: "Google Places is not configured (GOOGLE_MAPS_API_KEY not set)." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const query = str(b.query);
  if (!query) {
    return Response.json({ error: "A non-empty `query` is required." }, { status: 400 });
  }
  const rawMax = typeof b.maxResults === "number" ? b.maxResults : 10;
  const maxResults = Math.min(Math.max(Math.trunc(rawMax) || 10, 1), 20);
  // Safe default: only an explicit `false` performs writes.
  const dryRun = b.dryRun !== false;

  // Optional market (allow-list). Omitted → DC (DC-first, unchanged behavior);
  // present-but-invalid is rejected rather than silently coerced.
  let market: Market = DEFAULT_MARKET;
  if (b.market !== undefined && b.market !== null) {
    const m = typeof b.market === "string" ? b.market.trim().toLowerCase() : "";
    if (!isAllowedMarket(m)) {
      return Response.json({ error: "Invalid market (allowed: dc, nyc)." }, { status: 400 });
    }
    market = m;
  }

  const search = await searchPlacesText(query, maxResults);
  if (search.status !== "ok") {
    if (!dryRun) {
      await createIngestionJob({
        source: "google_places",
        query,
        dryRun: false,
        status: "failed",
        error:
          `${search.status}` +
          (search.httpStatus ? ` (${search.httpStatus})` : "") +
          (search.googleStatus ? ` ${search.googleStatus}` : ""),
      });
    }
    const code = search.status === "missing-api-key" ? 503 : 502;
    return Response.json(
      {
        error: "Google Places search failed.",
        status: search.status,
        httpStatus: search.httpStatus,
        googleStatus: search.googleStatus,
      },
      { status: code },
    );
  }

  // Only results with a usable display name can become a named candidate.
  const usable = search.results.filter((r) => r.displayName);

  // Freshness window for the Google-derived metadata (one stamp per run).
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + FRESHNESS_WINDOW_MS);

  // Snapshot of existing candidate Place IDs → status, for the exact-duplicate
  // check + score penalty (a DB READ only — dry runs still write nothing).
  // Score + rank highest-first.
  const existingByPlaceId = await getExistingCandidatePlaceStatuses();
  const existingPlaceIds = new Set(existingByPlaceId.keys());
  const ranked = scoreAndRank(usable, existingPlaceIds);

  if (dryRun) {
    // Mark exact duplicates by googlePlaceId so the preview is explicit about
    // what a real run would skip (and the status it would skip — e.g. rejected).
    const candidates = ranked.map(({ r, likelihood }) => {
      const dupStatus = r.placeId ? (existingByPlaceId.get(r.placeId) ?? null) : null;
      return {
        ...toCandidateInput(r, query, slugify(r.displayName ?? ""), fetchedAt, expiresAt, likelihood, market),
        isDuplicate: dupStatus !== null,
        duplicateOfStatus: dupStatus,
      };
    });
    return Response.json({ dryRun: true, query, found: candidates.length, candidates });
  }

  // Real import — iterate in ranked order so `created` comes back sorted.
  const usedSlugs = await getExistingCandidateSlugs();
  let imported = 0;
  let skippedDuplicates = 0;
  const created: CandidateRestaurant[] = [];
  // Exact googlePlaceId duplicates we skipped, with the reason/existing status.
  const duplicates: {
    googlePlaceId: string;
    name: string | null;
    existingId: string | null;
    existingStatus: string | null;
    reason: "existing-candidate" | "within-batch" | "race";
  }[] = [];
  // Belt-and-suspenders dedupe: guard against the SAME Place ID appearing twice
  // in one Google response (the per-row DB check below also catches this once a
  // prior row is persisted, but this avoids the second DB round-trip).
  const seenThisRun = new Set<string>();
  try {
    for (const { r, likelihood } of ranked) {
      const placeId = r.placeId;

      // (a) Same Place ID already handled in THIS run.
      if (seenThisRun.has(placeId)) {
        skippedDuplicates++;
        duplicates.push({
          googlePlaceId: placeId,
          name: r.displayName,
          existingId: null,
          existingStatus: null,
          reason: "within-batch",
        });
        continue;
      }

      // (b) Exact-duplicate by Google Place ID — NEVER by name (chains have many
      // locations). Status-INDEPENDENT: skips regardless of candidate/needs_review/
      // approved/rejected, and never revives a rejected row.
      const existing = await getCandidateByGooglePlaceId(placeId);
      if (existing) {
        skippedDuplicates++;
        seenThisRun.add(placeId);
        duplicates.push({
          googlePlaceId: placeId,
          name: r.displayName,
          existingId: existing.id,
          existingStatus: existing.status,
          reason: "existing-candidate",
        });
        continue;
      }

      const slug = uniqueSlug(slugify(r.displayName ?? ""), usedSlugs);
      usedSlugs.add(slug);
      const input = toCandidateInput(r, query, slug, fetchedAt, expiresAt, likelihood, market);

      // (c) Insert. The partial unique index on google_place_id (migration 0006)
      // makes a concurrent duplicate insert THROW, closing the TOCTOU window
      // between the pre-check and this insert: on throw we re-check and, if the
      // row now exists, count it as a skipped duplicate (a concurrent import won
      // the race) rather than failing the whole batch. A throw with no row is a
      // genuine error and is rethrown to the outer handler.
      let candidate: CandidateRestaurant | null = null;
      try {
        candidate = await insertCandidateRestaurant(input);
      } catch (err) {
        const now = await getCandidateByGooglePlaceId(placeId);
        if (now) {
          skippedDuplicates++;
          seenThisRun.add(placeId);
          duplicates.push({
            googlePlaceId: placeId,
            name: r.displayName,
            existingId: now.id,
            existingStatus: now.status,
            reason: "race",
          });
          continue;
        }
        throw err; // genuine failure → outer handler records + 500s
      }

      if (!candidate) {
        // No usable name (defensive) — not a duplicate, just skip silently.
        continue;
      }
      seenThisRun.add(placeId);

      // Provenance, kept separate from curated candidate fields (best-effort).
      // Raw expiring Google rating/count live here (admin metadata) — NOT public.
      await addRestaurantSource(candidate.id, {
        sourceType: "google_places",
        externalId: r.placeId,
        rawName: r.displayName,
        rawAddress: r.formattedAddress,
        url: r.websiteUri,
        notes:
          `Imported via Google Places Text Search: "${query}"` +
          ` | review-likelihood ${likelihood.score}` +
          (r.userRatingCount !== null
            ? ` | Google ${r.userRatingCount} ratings${r.rating !== null ? ` @ ${r.rating}` : ""}`
            : "") +
          (input.seedMatchWarning ? ` | ${input.seedMatchWarning}` : ""),
      });
      created.push(candidate);
      imported++;
    }
  } catch {
    // Safe, non-secret diagnostics (Place IDs are public; no key/body logged).
    console.error("[candidate-import] failed partway", { imported, skippedDuplicates });
    await createIngestionJob({
      source: "google_places",
      query,
      dryRun: false,
      status: "failed",
      candidatesCreated: imported,
      skippedDuplicates,
      error: "Import failed partway through.",
    });
    return Response.json({ error: "Failed to import candidates." }, { status: 500 });
  }

  // Safe summary (no secrets) — useful for diagnosing duplicate-skip behavior.
  console.info("[candidate-import] complete", {
    imported,
    skippedDuplicates,
    skippedPlaceIds: duplicates.map((d) => `${d.googlePlaceId}:${d.reason}`),
  });

  await createIngestionJob({
    source: "google_places",
    query,
    dryRun: false,
    status: "success",
    candidatesCreated: imported,
    skippedDuplicates,
    notes: `Text Search import for "${query}" (max ${maxResults}); ${usable.length} usable results.`,
  });

  return Response.json(
    { imported, skippedDuplicates, duplicates, candidates: created },
    { status: 201 },
  );
}
