import { adminError, adminJson, adminUrl, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { splitAuditReason } from "@/lib/adminAudit";
import { validateVideoCandidateBody } from "@/lib/adminVideoValidation";
import { getCandidateRef, getPublishedRefBySlug } from "@/lib/db/identity";
import {
  createVideoCandidate,
  getAssociationSummaries,
  listVideoCandidates,
} from "@/lib/db/videoCandidates";
import { resolveSocialVideo } from "@/lib/socialVideo";
import { resolveAssociation } from "@/lib/videoAssociation";

/*
  /api/admin/videos/candidates  (INTERNAL, admin credential required)
  Social-video intake/review queue. NOTHING here is shown on a profile; a candidate only reaches
  restaurant_videos via an explicit attach of an APPROVED candidate by the publication credential.

  Credentials: the draft credential may list and create candidates (always status needs_review).

  POST  Body: { sourceUrl, candidateRestaurantId?, restaurantSlug?, proposedRestaurantName?, reviewNotes?,
                creatorHandle?, creatorName?, attributionText?, caption? }
        The restaurant link is by STABLE ID: `candidateRestaurantId` for a draft (or promoted) restaurant,
        or `restaurantSlug` for a published restaurant. A reference that does not exist, refers to two
        different restaurants, or crosses markets is rejected with a structured 422. Typed slugs of
        restaurants that do not exist are no longer accepted.
        201 -> { candidate, id, adminUrl, association, warnings }; 409 duplicate -> { code: "duplicate_video", existing }.
  GET   ?status=&platform=&restaurantSlug=&candidateRestaurantId=  -> { candidates (+association, adminUrl), adminScope }
*/
export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  try {
    let candidates = await listVideoCandidates({
      status: sp.get("status") ?? undefined,
      platform: sp.get("platform") ?? undefined,
      restaurantSlug: sp.get("restaurantSlug") ?? undefined,
    });
    const byRestaurant = sp.get("candidateRestaurantId");
    if (byRestaurant) candidates = candidates.filter((c) => c.candidateRestaurantId === byRestaurant);
    const associations = await getAssociationSummaries(candidates);
    return adminJson({
      candidates: candidates.map((c) => ({
        ...c,
        association: associations[c.id] ?? null,
        adminUrl: adminUrl(req, "/admin/videos/candidates", { candidate: c.id }),
      })),
      adminScope: auth.scope,
    });
  } catch {
    return adminError(500, "list_failed", "Failed to list candidates.", { retryable: true });
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminError(400, "invalid_json", "Invalid JSON body.");
  }
  const split = splitAuditReason(body);
  if (!split.ok) return validationError([{ field: "auditReason", code: "invalid_reason", message: split.message }]);
  const audit = auditContext(auth, { reason: split.reason });
  const parsed = validateVideoCandidateBody(split.body, "create");
  if (!parsed.ok) return validationError(parsed.errors);
  const w = parsed.value;

  const association = await resolveAssociation(
    { candidateRestaurantId: w.candidateRestaurantId, restaurantSlug: w.restaurantSlug },
    { candidateById: getCandidateRef, publishedBySlug: getPublishedRefBySlug },
  );
  if (!association.ok) {
    return validationError([{ field: association.field, code: association.code, message: association.message }]);
  }

  const result = await resolveSocialVideo(w.sourceUrl!);
  if (!result.ok) {
    return adminError(422, "unsupported_url", result.error, { field: "sourceUrl" });
  }
  const r = result.resolved;

  try {
    const { candidate, duplicate } = await createVideoCandidate({
      platform: r.platform,
      sourceUrl: r.sourceUrl,
      normalizedSourceUrl: r.normalizedSourceUrl,
      platformVideoId: r.platformVideoId,
      // Values the caller verified win over the resolver, which no longer returns a creator for TikTok.
      creatorHandle: w.creatorHandle ?? r.creatorHandle,
      creatorName: w.creatorName ?? r.creatorName,
      caption: w.caption ?? r.caption,
      thumbnailUrl: r.thumbnailUrl,
      embedUrl: r.embedUrl,
      attributionText: w.attributionText ?? r.attributionText,
      publishedAt: r.publishedAt,
      sourceFetchedAt: r.sourceFetchedAt,
      legalDisplayStatus: r.legalDisplayStatus,
      resolverStatus: r.resolverStatus,
      resolverError: r.resolverError,
      restaurantSlug: association.restaurantSlug,
      candidateRestaurantId: association.candidateRestaurantId,
      proposedRestaurantName: w.proposedRestaurantName ?? null,
      reviewNotes: w.reviewNotes ?? null,
    }, audit);
    const link = adminUrl(req, "/admin/videos/candidates", { candidate: candidate.id });
    if (duplicate) {
      return adminError(409, "duplicate_video", "A candidate for this video already exists.", {
        candidate, existing: { id: candidate.id, status: candidate.status, adminUrl: link },
      });
    }
    const summaries = await getAssociationSummaries([candidate]);
    const warnings = association.kind === "none"
      ? [{ code: "no_restaurant_linked", message: "The video is not linked to a restaurant yet." }]
      : [];
    return adminJson({ candidate, id: candidate.id, adminUrl: link, association: summaries[candidate.id] ?? null, warnings }, 201);
  } catch {
    return adminError(500, "create_failed", "Failed to create candidate. Check the queue for it before retrying.", { retryable: false });
  }
}
