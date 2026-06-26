import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { createVideoCandidate, isDbConfigured } from "@/lib/db/videoCandidates";
import { resolveSocialVideo, type ResolvedSocialVideo } from "@/lib/socialVideo";
import { scoreDiscoveryLead, type ScoreRestaurantInput } from "@/lib/discovery/scoreDiscoveryLead";
import type { DiscoveryLead, DetectedPlatform, LeadResolverStatus } from "@/lib/discovery/normalizeSearchResults";

/*
  POST /api/admin/restaurants/[slug]/discovery/candidates  (INTERNAL, admin-secret)

  Social video discovery — Slice 3: turn ADMIN-SELECTED dry-run leads into
  `video_candidates` (status "needs_review") pre-associated to the restaurant.

  This is the first discovery slice that writes — and it writes ONLY to
  `video_candidates`, via the same canonical `createVideoCandidate` path used by
  the manual intake route. It NEVER writes restaurant_videos, never attaches,
  never approves, and never auto-runs. The client is not trusted: every selected
  URL is RE-RESOLVED server-side through resolveSocialVideo, and identity fields
  (platform / normalizedSourceUrl / platformVideoId / embedUrl / legalDisplayStatus)
  + the match score come from the server, not the request body. Dedupe is enforced
  by createVideoCandidate (normalizedSourceUrl, then platform+videoId).

  Guards: 503 no admin secret · 401 bad secret · 503 no DB · 404 unknown restaurant.
  Body: { leads: [{ url, title?, snippet?, query?, provider?, rank?, ... }] } (max 20).
*/

const MAX_SELECTED_LEADS = 20;

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.min(Math.max(n, min), max);
}
function clampStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Map the resolver's status onto the scorer's narrower vocab (scoring only). */
function scoringResolverStatus(r: ResolvedSocialVideo): LeadResolverStatus {
  if (r.resolverStatus === "error") return "failed";
  return r.legalDisplayStatus === "embeddable" ? "resolved" : "source-link-only";
}

interface CreatedItem {
  id: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platform: string;
  status: string;
  matchConfidence: number | null;
}
interface FailedItem {
  url: string;
  error: string;
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
  // This slice WRITES, so (unlike the dry-run search/query routes) it requires a DB.
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
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
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawLeads = Array.isArray(body.leads) ? body.leads : [];
  // Keep only entries that carry a usable URL string.
  const leads = rawLeads
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
    .map((l) => ({
      url: clampStr(l.url, 2048),
      title: clampStr(l.title, 300),
      snippet: clampStr(l.snippet, 600),
      query: clampStr(l.query, 200),
      rank: clampInt(l.rank, 0, 0, 9999),
    }))
    .filter((l) => l.url.length > 0);

  if (leads.length === 0) {
    return Response.json({ error: "Provide at least one lead with a `url`." }, { status: 400 });
  }
  if (leads.length > MAX_SELECTED_LEADS) {
    return Response.json(
      { error: `Too many leads selected (max ${MAX_SELECTED_LEADS} per request).` },
      { status: 400 },
    );
  }

  const scoreInput: ScoreRestaurantInput = {
    name: restaurant.name,
    market: restaurant.market,
    address: restaurant.address,
    neighborhood: restaurant.neighborhood,
    cuisineTags: restaurant.cuisineTags,
    dishHighlights: restaurant.dishHighlights,
  };

  // Re-resolve every selected URL server-side (parallel, bounded by the cap). The
  // resolver never throws per its contract, but we guard defensively so one bad
  // URL can't reject the batch.
  const resolved = await Promise.all(
    leads.map(async (lead) => {
      try {
        const res = await resolveSocialVideo(lead.url);
        return { lead, res };
      } catch {
        return { lead, res: { ok: false as const, error: "Resolver error." } };
      }
    }),
  );

  const created: CreatedItem[] = [];
  const duplicates: CreatedItem[] = [];
  const failed: FailedItem[] = [];

  // Create SEQUENTIALLY so dedupe accounting is deterministic: if two selected
  // URLs canonicalize to the same normalizedSourceUrl, the first inserts and the
  // second is reported a duplicate (createVideoCandidate is the single source of
  // dedupe truth — normalizedSourceUrl, then platform+videoId).
  for (const { lead, res } of resolved) {
    if (!res.ok) {
      failed.push({ url: lead.url, error: res.error });
      continue;
    }
    const r = res.resolved;

    // Recompute the match score server-side from RESOLVED identity fields + the
    // lead's text. Any client-supplied matchConfidence/matchReasons are ignored.
    const detected = r.platform as DetectedPlatform;
    const scoringLead: DiscoveryLead = {
      key: `${detected}:${r.normalizedSourceUrl}`,
      title: lead.title,
      url: r.sourceUrl,
      snippet: lead.snippet,
      provider: "brave",
      rank: lead.rank,
      query: lead.query,
      platformTarget: null,
      detectedPlatform: detected,
      resolverStatus: scoringResolverStatus(r),
      platformVideoId: r.platformVideoId,
      embedUrl: r.embedUrl,
      legalDisplayStatus: r.legalDisplayStatus,
      normalizedSourceUrl: r.normalizedSourceUrl,
    };
    const { matchConfidence, matchReasons } = scoreDiscoveryLead(scoringLead, scoreInput);

    // Compact discovery provenance kept in EXISTING fields only (no raw provider
    // blobs, no secrets).
    const provenance = lead.query
      ? `Discovery: Brave query "${lead.query}"${lead.rank ? ` rank ${lead.rank}` : ""}`
      : "Discovery: Brave search lead";
    const reviewNote = lead.query
      ? `Discovery lead from Brave query: "${lead.query}"${lead.rank ? ` rank ${lead.rank}` : ""}`
      : "Discovery lead from Brave search.";

    try {
      const { candidate, duplicate } = await createVideoCandidate({
        platform: r.platform,
        sourceUrl: r.sourceUrl,
        normalizedSourceUrl: r.normalizedSourceUrl,
        platformVideoId: r.platformVideoId,
        creatorHandle: r.creatorHandle,
        creatorName: r.creatorName,
        caption: r.caption,
        thumbnailUrl: r.thumbnailUrl,
        embedUrl: r.embedUrl,
        attributionText: r.attributionText,
        publishedAt: r.publishedAt,
        sourceFetchedAt: r.sourceFetchedAt,
        legalDisplayStatus: r.legalDisplayStatus,
        resolverStatus: r.resolverStatus,
        resolverError: r.resolverError,
        // Server-controlled review routing — the resolved restaurant's slug.
        restaurantSlug: restaurant.id,
        matchConfidence,
        matchReasons: [...matchReasons, provenance],
        reviewNotes: reviewNote,
      });
      const item: CreatedItem = {
        id: candidate.id,
        sourceUrl: candidate.sourceUrl,
        normalizedSourceUrl: candidate.normalizedSourceUrl,
        platform: candidate.platform,
        status: candidate.status,
        matchConfidence: candidate.matchConfidence,
      };
      if (duplicate) duplicates.push(item);
      else created.push(item);
    } catch {
      failed.push({ url: lead.url, error: "Failed to create candidate." });
    }
  }

  return Response.json(
    {
      restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.id },
      created,
      duplicates,
      failed,
      stats: {
        requested: leads.length,
        created: created.length,
        duplicates: duplicates.length,
        failed: failed.length,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
