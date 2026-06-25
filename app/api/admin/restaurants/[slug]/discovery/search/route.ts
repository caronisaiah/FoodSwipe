import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { generateDiscoveryQueries } from "@/lib/discovery/queryGenerator";
import { braveProvider, SearchAuthError, type RawSearchResult } from "@/lib/discovery/searchProvider";
import {
  normalizeLead,
  platformTargetFromQuery,
  simpleUrlKey,
  type DiscoveryLead,
} from "@/lib/discovery/normalizeSearchResults";
import { scoreDiscoveryLead } from "@/lib/discovery/scoreDiscoveryLead";
import { resolveSocialVideo } from "@/lib/socialVideo";

/*
  POST /api/admin/restaurants/[slug]/discovery/search  (INTERNAL, admin-secret)

  Social video discovery — Slice 2: provider-backed DRY-RUN. Runs the restaurant's
  generated queries through Brave Web Search (server-side; key never leaves the
  server), normalizes results to social leads, optionally resolves each through the
  existing resolveSocialVideo pipeline, and scores them. Returns leads only.

  WRITES NOTHING: no video_candidates, no restaurant_videos, no DB mutations, no
  attach. Guards: 503 no admin secret · 401 bad secret · 503 if BRAVE_SEARCH_API_KEY
  unset · 404 unknown restaurant · 502 if Brave rejects the key. `no-store`.

  Body (all optional): { queries?: string[], maxQueries?: number, maxResultsPerQuery?: number, resolve?: boolean }
*/

const MAX_QUERIES_CAP = 8;
const MAX_RESULTS_CAP = 10;
const MAX_LEADS = 40; // bounds resolver fan-out + keeps the response compact

const PLATFORM_PRIORITY: Record<string, number> = { tiktok: 0, instagram: 1, youtube: 2 };

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.min(Math.max(n, min), max);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!braveProvider.isConfigured()) {
    return Response.json(
      { error: "Brave Search is not configured (BRAVE_SEARCH_API_KEY not set)." },
      { status: 503 },
    );
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // body is optional — defaults apply
  }

  const maxQueries = clampInt(body.maxQueries, 5, 1, MAX_QUERIES_CAP);
  const maxResultsPerQuery = clampInt(body.maxResultsPerQuery, 5, 1, MAX_RESULTS_CAP);
  const resolve = body.resolve !== false; // default true

  // Which queries to run: caller-supplied strings, else generated.
  const generated = generateDiscoveryQueries({
    name: restaurant.name,
    slug: restaurant.id,
    neighborhood: restaurant.neighborhood,
    address: restaurant.address,
    cuisineTags: restaurant.cuisineTags,
    dishHighlights: restaurant.dishHighlights,
    websiteDomain: restaurant.websiteDomain,
  });
  const requested = Array.isArray(body.queries)
    ? body.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    : [];
  const queryStrings = (requested.length > 0 ? requested : generated.map((g) => g.query)).slice(0, maxQueries);

  // Run queries sequentially (Brave free tier is rate-limited). Per-query failures
  // are tolerated; only an invalid key aborts the whole run.
  const raws: RawSearchResult[] = [];
  const queriesRun: string[] = [];
  let failedQueries = 0;
  for (const q of queryStrings) {
    queriesRun.push(q);
    try {
      const rs = await braveProvider.search(q, maxResultsPerQuery);
      raws.push(...rs);
    } catch (e) {
      if (e instanceof SearchAuthError) {
        return Response.json({ error: "Brave Search rejected the API key." }, { status: 502 });
      }
      failedQueries++;
    }
  }

  const rawResults = raws.length;

  // Normalize → social leads (non-social URLs dropped).
  let leads = raws
    .map((r) => normalizeLead(r, platformTargetFromQuery(r.query)))
    .filter((l): l is DiscoveryLead => l !== null);
  const socialResults = leads.length;

  // Pre-resolve dedupe by URL (cuts resolver cost), keep the best-ranked.
  let duplicatesSkipped = 0;
  const seen = new Map<string, DiscoveryLead>();
  for (const lead of leads) {
    const key = simpleUrlKey(lead.url);
    const prev = seen.get(key);
    if (!prev) seen.set(key, lead);
    else {
      duplicatesSkipped++;
      if (lead.rank < prev.rank) seen.set(key, lead);
    }
  }
  leads = Array.from(seen.values()).sort((a, b) => a.rank - b.rank).slice(0, MAX_LEADS);

  // Resolve through the existing pipeline (parallel, bounded by MAX_LEADS). A
  // resolver failure never aborts the run — it just marks that lead "failed".
  let resolved = 0;
  let failed = 0;
  if (resolve) {
    await Promise.all(
      leads.map(async (lead) => {
        try {
          const r = await resolveSocialVideo(lead.url);
          if (r.ok) {
            lead.canonicalUrl = r.resolved.sourceUrl;
            lead.normalizedSourceUrl = r.resolved.normalizedSourceUrl;
            lead.platformVideoId = r.resolved.platformVideoId;
            lead.embedUrl = r.resolved.embedUrl;
            lead.legalDisplayStatus = r.resolved.legalDisplayStatus;
            lead.resolverStatus = r.resolved.legalDisplayStatus === "embeddable" ? "resolved" : "source-link-only";
            resolved++;
          } else {
            lead.resolverStatus = "failed";
            lead.resolverError = r.error;
            failed++;
          }
        } catch {
          lead.resolverStatus = "failed";
          lead.resolverError = "Resolver error.";
          failed++;
        }
      }),
    );

    // Second dedupe by canonical normalizedSourceUrl (e.g. short link → canonical).
    const canon = new Map<string, DiscoveryLead>();
    const collapsed: DiscoveryLead[] = [];
    for (const lead of leads) {
      const key = lead.normalizedSourceUrl ?? simpleUrlKey(lead.url);
      if (canon.has(key)) {
        duplicatesSkipped++;
        continue;
      }
      canon.set(key, lead);
      collapsed.push(lead);
    }
    leads = collapsed;
  }

  // Score (no engagement counts).
  const scoreInput = {
    name: restaurant.name,
    address: restaurant.address,
    neighborhood: restaurant.neighborhood,
    cuisineTags: restaurant.cuisineTags,
    dishHighlights: restaurant.dishHighlights,
  };
  for (const lead of leads) {
    const { matchConfidence, matchReasons } = scoreDiscoveryLead(lead, scoreInput);
    lead.matchConfidence = matchConfidence;
    lead.matchReasons = matchReasons;
  }

  // Sort: confidence desc → platform priority → provider rank.
  leads.sort((a, b) => {
    const c = (b.matchConfidence ?? 0) - (a.matchConfidence ?? 0);
    if (c !== 0) return c;
    const p = (PLATFORM_PRIORITY[a.detectedPlatform ?? ""] ?? 9) - (PLATFORM_PRIORITY[b.detectedPlatform ?? ""] ?? 9);
    if (p !== 0) return p;
    return a.rank - b.rank;
  });

  return Response.json(
    {
      restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.id },
      provider: "brave",
      queriesRun,
      leads,
      stats: { rawResults, socialResults, resolved, failed, duplicatesSkipped, failedQueries },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
