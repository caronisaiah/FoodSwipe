import { adminError, adminJson, candidateReviewUrl } from "@/lib/adminApi";
import { guardAdmin } from "@/lib/adminGuard";
import {
  buildChecklist,
  mapReadiness,
  videoEvidenceStages,
  latestDeclaration,
  type AuditEventLite,
} from "@/lib/adminReview";
import { getCandidateRestaurant } from "@/lib/db/candidates";
import { enrichCandidates } from "@/lib/db/candidateEnrichment";
import { listAdminEvents } from "@/lib/db/auditEvents";
import { getPromotedRestaurantForCandidate, listIdentityRecords } from "@/lib/db/identity";
import { getLocationStatusesForRestaurant } from "@/lib/db/restaurantLocations";
import { getAssociationSummaries, listVideoCandidatesForRestaurant } from "@/lib/db/videoCandidates";
import { evaluatePublicationChecks } from "@/lib/publicationChecks";
import { isEmbedUrlAllowed } from "@/lib/video";
import type { AdminEventView } from "@/lib/adminAudit";

/*
  GET /api/admin/restaurants/candidates/[id]/review  (INTERNAL, admin credential required, READ-ONLY)

  Everything the unified review workspace needs about ONE restaurant draft, in one round trip, so a reviewer
  never has to move between pages to see it:
    candidate      the draft, with the same readiness / evidence / hero / conflict signals as the list
    promoted       the published restaurant made from it, if any
    publicationChecks  the real backend publication rules (place identity, duplicates, pin outside the market)
    videos         every video lead tied to this draft (by id, or legacy slug-only), each with its association,
                   embed capability and the five-step evidence stages
    mapReadiness   whether the map could show it (it never implies publishing creates a map point)
    checklist      complete / missing / invalid / needs-a-person, mirroring what promotion enforces
    audit          recent events for the draft and its video leads, PUBLICATION CREDENTIAL ONLY

  It never calls Google, never resolves a video, and writes nothing: opening the page can never approve,
  promote, attach or change anything. The draft credential may read it, but receives no audit history.
  Guard order: config 503 -> unauthenticated 401 -> DB 503 (see lib/adminGuard).
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const base = await getCandidateRestaurant(id);
    if (!base) return adminError(404, "not_found", "Candidate not found.");

    const [[enriched], promoted, identityIndex, leads] = await Promise.all([
      enrichCandidates([base]),
      getPromotedRestaurantForCandidate(id),
      listIdentityRecords(),
      listVideoCandidatesForRestaurant(id, base.slug),
    ]);

    const publicationChecks = evaluatePublicationChecks(base, identityIndex);
    const associations = await getAssociationSummaries(leads);

    // Audit history is sensitive: the publication credential only. A draft credential gets no events at all.
    const canReadAudit = auth.scope === "publish";
    // The draft's own history, plus each lead's own history: a lead linked by slug only has no restaurant id on its
    // events, so asking for the restaurant's id alone would miss its approval (and any declaration on it).
    const [restaurantPage, ...leadPages] = canReadAudit
      ? await Promise.all([listAdminEvents({ resourceId: id, limit: 100 }), ...leads.map((lead) => listAdminEvents({ resourceId: lead.id, limit: 50 }))])
      : [{ events: [] as AdminEventView[] }];
    const merged = new Map<string, AdminEventView>();
    for (const e of [...restaurantPage.events, ...leadPages.flatMap((p) => p.events)]) merged.set(e.id, e);
    const page = { events: [...merged.values()].sort((a, b) => b.seq - a.seq) };
    const lite = (e: AdminEventView): AuditEventLite => ({ action: e.action, actorIdentity: e.actorIdentity, authScope: e.authScope, reason: e.reason, occurredAt: e.occurredAt });
    const eventsFor = (videoId: string): AuditEventLite[] | null =>
      canReadAudit ? page.events.filter((e) => e.resourceId === videoId || e.details?.videoCandidateId === videoId).map(lite) : null;

    const videos = leads.map((lead) => {
      const events = eventsFor(lead.id);
      return {
        ...lead,
        association: associations[lead.id] ?? null,
        linkedBy: lead.candidateRestaurantId ? ("id" as const) : ("slug" as const),
        canEmbed: isEmbedUrlAllowed(lead.embedUrl),
        verticalEmbed: lead.platform === "tiktok" || lead.platform === "instagram",
        stages: videoEvidenceStages(lead, events),
        declaration: latestDeclaration(events),
      };
    });

    const published = promoted ? { slug: promoted.slug, status: promoted.status } : null;
    const locationStatuses = promoted ? await getLocationStatusesForRestaurant(promoted.id) : null;
    const counts = {
      total: videos.length,
      approved: videos.filter((v) => v.status === "approved").length,
      attached: videos.filter((v) => v.status === "attached").length,
      underReview: videos.filter((v) => v.status === "needs_review").length,
      rejected: videos.filter((v) => v.status === "rejected").length,
      slugOnly: videos.filter((v) => v.linkedBy === "slug").length,
    };

    const checklist = buildChecklist({
      status: base.status, name: base.name, address: base.address, neighborhood: base.neighborhood,
      lat: base.lat, lng: base.lng, market: base.market, googlePlaceId: base.googlePlaceId, websiteDomain: base.websiteDomain,
      priceLevel: base.priceLevel, cuisineTags: base.cuisineTags, vibeTags: base.vibeTags, bestFor: base.bestFor, reasonText: base.reasonText,
      hasApprovedHero: enriched.hasApprovedHeroSelection,
      readiness: enriched.readiness,
      publicationChecks,
      promotionConflict: enriched.promotionConflict?.conflict ?? null,
      published,
      videoCounts: counts,
    });

    return adminJson({
      candidate: { ...enriched, adminUrl: candidateReviewUrl(req, base.id) },
      promoted: promoted ? { id: promoted.id, slug: promoted.slug, status: promoted.status, market: promoted.market } : null,
      publicationChecks,
      videos,
      mapReadiness: mapReadiness({ lat: base.lat, lng: base.lng, market: base.market, published, locationStatuses }),
      checklist,
      audit: { visible: canReadAudit, events: page.events.slice(0, 25) },
      adminScope: auth.scope,
    });
  } catch {
    return adminError(500, "review_failed", "Could not load the restaurant review.", { retryable: true });
  }
}
