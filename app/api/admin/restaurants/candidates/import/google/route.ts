import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { searchPlacesText, type PlaceTextResult } from "@/lib/places";
import {
  addRestaurantSource,
  createIngestionJob,
  getCandidateByGooglePlaceId,
  getExistingCandidatePlaceStatuses,
  getExistingCandidateSlugs,
  getExistingRestaurantPlaceStatusesForImport,
  insertCandidateRestaurant,
  isDbConfigured,
  slugify,
  type CandidateRestaurant,
} from "@/lib/db/candidates";
import { scoreReviewLikelihood, type ReviewLikelihood } from "@/lib/reviewLikelihood";
import { suggestCandidateTags } from "@/lib/candidateTagger";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import { DEFAULT_MARKET, isAllowedMarket, type Market } from "@/lib/markets";
import { signImportPreview, verifyImportPreview } from "@/lib/restaurantImportPreview";

/*
  POST /api/admin/restaurants/candidates/import/google  (INTERNAL, admin-secret)

  Phase 2 restaurant automation — Google Places API (New) Text Search → candidate
  REVIEW rows. NOTHING is published to /feed; imported rows land as
  status="needs_review", source="google_places", for a human to curate/approve.

  Preview body: { query, maxResults?, market?, dryRun?: true }
  Write body: same context + dryRun:false, previewToken, selectedPlaceIds (1–20).
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
  try {
    return await importRequest(req);
  } catch {
    return Response.json({ error: "Could not prepare the candidate import. No result was confirmed; retry safely." }, { status: 500 });
  }
}

async function importRequest(req: Request): Promise<Response> {
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
  if (!query || query.length > 1024) {
    return Response.json({ error: "A non-empty `query` of at most 1024 characters is required." }, { status: 400 });
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

  const context = { query, maxResults, market };
  let selectedPlaceIds: string[] = [];
  if (!dryRun) {
    if (
      !Array.isArray(b.selectedPlaceIds) || b.selectedPlaceIds.length === 0 ||
      b.selectedPlaceIds.length > 20 || !b.selectedPlaceIds.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 256 && id.trim() === id,
      )
    ) {
      return Response.json({ error: "Select 1–20 Google Place IDs from a current preview." }, { status: 400 });
    }
    const eligibleIds = verifyImportPreview(b.previewToken, context, process.env.FOODSWIPE_ADMIN_SECRET!);
    if (!eligibleIds) {
      return Response.json({ error: "Preview expired, changed, or invalid. Search again before importing." }, { status: 409 });
    }
    selectedPlaceIds = [...new Set(b.selectedPlaceIds as string[])];
    if (selectedPlaceIds.some((id) => !eligibleIds.includes(id))) {
      return Response.json({ error: "Selected IDs must be eligible restaurants from this preview." }, { status: 400 });
    }
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
  const existingRestaurants = await getExistingRestaurantPlaceStatusesForImport();
  const existingPlaceIds = new Set([...existingByPlaceId.keys(), ...existingRestaurants.keys()]);
  const ranked = scoreAndRank(usable, existingPlaceIds);

  if (dryRun) {
    // Mark exact duplicates by googlePlaceId so the preview is explicit about
    // what a real run would skip (and the status it would skip — e.g. rejected).
    const seen = new Set<string>();
    const candidates = ranked.map(({ r, likelihood }) => {
      const dupStatus = r.placeId ? (existingByPlaceId.get(r.placeId) ?? null) : null;
      const restaurantStatus = existingRestaurants.get(r.placeId) ?? null;
      const repeated = seen.has(r.placeId);
      seen.add(r.placeId);
      return {
        ...toCandidateInput(r, query, slugify(r.displayName ?? ""), fetchedAt, expiresAt, likelihood, market),
        isDuplicate: dupStatus !== null || restaurantStatus !== null || repeated,
        duplicateOfStatus: dupStatus ?? restaurantStatus,
        duplicateOfKind: dupStatus !== null ? "candidate" : restaurantStatus !== null ? "restaurant" : repeated ? "preview" : null,
      };
    });
    const previewToken = signImportPreview(
      context,
      candidates.filter((candidate) => !candidate.isDuplicate).map((candidate) => candidate.googlePlaceId),
      process.env.FOODSWIPE_ADMIN_SECRET!,
    );
    return Response.json({ dryRun: true, query, found: candidates.length, candidates, previewToken });
  }

  // Import ONLY selected IDs, with server-resolved fields. Repeated Google rows
  // represent one requested identity, not an extra candidate or outcome.
  const selected = new Set(selectedPlaceIds);
  const seenResults = new Set<string>();
  const chosen = ranked.filter(({ r }) => {
    if (!selected.has(r.placeId) || seenResults.has(r.placeId)) return false;
    seenResults.add(r.placeId);
    return true;
  });
  const usedSlugs = await getExistingCandidateSlugs();
  let imported = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  const created: CandidateRestaurant[] = [];
  // Exact googlePlaceId duplicates we skipped, with the reason/existing status.
  const duplicates: {
    googlePlaceId: string;
    name: string | null;
    existingId: string | null;
    existingStatus: string | null;
    reason: "existing-candidate" | "existing-restaurant" | "race";
  }[] = [];
  const outcomes: {
    googlePlaceId: string;
    name: string | null;
    status: "imported" | "skipped" | "failed";
    existingStatus?: string;
    duplicateOfKind?: "candidate" | "restaurant";
    error?: string;
  }[] = [];
  for (const id of selectedPlaceIds) {
    if (!seenResults.has(id)) {
      const candidateStatus = existingByPlaceId.get(id);
      const restaurantStatus = existingRestaurants.get(id);
      if (candidateStatus !== undefined || restaurantStatus !== undefined) {
        const existingStatus = candidateStatus ?? restaurantStatus!;
        skippedDuplicates++;
        duplicates.push({ googlePlaceId: id, name: null, existingId: null, existingStatus,
          reason: candidateStatus !== undefined ? "existing-candidate" : "existing-restaurant" });
        outcomes.push({ googlePlaceId: id, name: null, status: "skipped", existingStatus,
          duplicateOfKind: candidateStatus !== undefined ? "candidate" : "restaurant" });
      } else {
        failed++;
        outcomes.push({ googlePlaceId: id, name: null, status: "failed", error: "No longer returned by Google. Search again." });
      }
    }
  }
  for (const { r, likelihood } of chosen) {
    const placeId = r.placeId;
    try {
      // Status-independent candidate dedupe remains authoritative, including the
      // existing partial unique index and race re-check below.
      const existing = await getCandidateByGooglePlaceId(placeId);
      const restaurantStatus = existingRestaurants.get(placeId);
      if (existing || restaurantStatus !== undefined) {
        skippedDuplicates++;
        duplicates.push({
          googlePlaceId: placeId,
          name: r.displayName,
          existingId: existing?.id ?? null,
          existingStatus: existing?.status ?? restaurantStatus ?? null,
          reason: existing ? "existing-candidate" : "existing-restaurant",
        });
        outcomes.push({ googlePlaceId: placeId, name: r.displayName, status: "skipped",
          existingStatus: existing?.status ?? restaurantStatus, duplicateOfKind: existing ? "candidate" : "restaurant" });
        continue;
      }

      const slug = uniqueSlug(slugify(r.displayName ?? ""), usedSlugs);
      usedSlugs.add(slug);
      const input = toCandidateInput(r, query, slug, fetchedAt, expiresAt, likelihood, market);

      const candidate = await insertCandidateRestaurant(input);
      if (!candidate) throw new Error("No candidate returned");
      created.push(candidate);
      imported++;
      outcomes.push({ googlePlaceId: placeId, name: r.displayName, status: "imported", existingStatus: candidate.status });

      // Provenance, kept separate from curated candidate fields (best-effort).
      // Raw expiring Google rating/count live here (admin metadata) — NOT public.
      try {
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
      } catch {
        // The candidate already exists. Best-effort provenance must not turn a
        // confirmed write into a failed/skipped second outcome.
      }
    } catch {
      let now: CandidateRestaurant | null = null;
      try { now = await getCandidateByGooglePlaceId(placeId); } catch { /* DB still unavailable. */ }
      if (now) {
        skippedDuplicates++;
        duplicates.push({ googlePlaceId: placeId, name: r.displayName, existingId: now.id, existingStatus: now.status, reason: "race" });
        outcomes.push({ googlePlaceId: placeId, name: r.displayName, status: "skipped", existingStatus: now.status, duplicateOfKind: "candidate" });
      } else {
        failed++;
        outcomes.push({ googlePlaceId: placeId, name: r.displayName, status: "failed", error: "Could not import this restaurant. Retry safely." });
      }
    }
  }

  // Safe summary (no secrets) — useful for diagnosing duplicate-skip behavior.
  console.info("[candidate-import] complete", {
    imported,
    skippedDuplicates,
    failed,
    skippedPlaceIds: duplicates.map((d) => `${d.googlePlaceId}:${d.reason}`),
  });

  try {
    await createIngestionJob({
      source: "google_places",
      query,
      dryRun: false,
      status: failed > 0 ? "failed" : "success",
      candidatesCreated: imported,
      skippedDuplicates,
      error: failed > 0 ? `${failed} selected restaurant(s) failed.` : undefined,
      notes: `Selective Text Search import for "${query}" (max ${maxResults}); ${selectedPlaceIds.length} requested; ${failed} failed.`,
    });
  } catch {
    // Preserve confirmed per-row outcomes if best-effort audit logging fails.
  }

  return Response.json(
    { requested: selectedPlaceIds.length, imported, skippedDuplicates, failed, duplicates, outcomes, candidates: created },
    { status: imported > 0 ? 201 : 200 },
  );
}
