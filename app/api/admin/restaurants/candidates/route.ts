import { adminError, adminJson, adminUrl, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { splitAuditReason } from "@/lib/adminAudit";
import { validateCandidateBody } from "@/lib/adminValidation";
import { findPossibleDuplicates } from "@/lib/duplicateWarnings";
import {
  CANDIDATE_STATUSES,
  addRestaurantSource,
  getExistingCandidateSlugs,
  insertCandidateRestaurant,
  listCandidateRestaurants,
  slugify,
  type CandidateStatus,
} from "@/lib/db/candidates";
import { findPlaceIdConflict, listIdentityRecords } from "@/lib/db/identity";
import { getCandidateEvidenceMetaMap } from "@/lib/db/restaurantEvidence";
import { getApprovedHeroSelectionMapForCandidates } from "@/lib/db/heroMediaSelections";
import { getCandidatePromotionConflictMap } from "@/lib/db/restaurants";
import { getCandidateVideoMetaMap } from "@/lib/db/videoCandidates";
import { computeCandidateReadiness } from "@/lib/candidateReadiness";

/*
  Restaurant candidate ingestion — INTERNAL, admin credential required. These routes manage a REVIEW
  staging area only; candidates never reach `/feed`.

  Credentials (see lib/adminAuth): the draft credential may read, list and create drafts; it can never
  approve or promote. Guard order: config 503 -> unauthenticated 401 -> insufficient scope 403 -> DB 503.

  GET  /api/admin/restaurants/candidates[?status=candidate|approved|rejected|needs_review]
  POST /api/admin/restaurants/candidates
       Body: { name, market, ...optional fields }. `market` is REQUIRED (there is no default).
       Unknown fields, bad enums, unknown cuisine/vibe/dietary tags, invalid price or coordinates -> 422
       { error, code: "validation_failed", errors: [{ field, code, message }] }.
       A Google Place ID that already exists -> 409 { code: "place_id_conflict", existing }.
       Possible duplicates by name/address are returned as non-blocking `warnings`; branches are never merged.
       201 -> { candidate, id, adminUrl, warnings }.
*/

export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "draft");
  if (!auth.ok) return auth.response;

  const statusParam = new URL(req.url).searchParams.get("status");
  const status: CandidateStatus | undefined =
    statusParam && (CANDIDATE_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as CandidateStatus)
      : undefined;
  if (statusParam && !status) {
    return adminError(422, "invalid_status", `status must be one of: ${CANDIDATE_STATUSES.join(", ")}.`, { field: "status" });
  }

  try {
    const candidates = await listCandidateRestaurants(status);
    const candidateIds = candidates.map((c) => c.id);
    const [evidenceMeta, videoMeta, promotionConflicts, heroSelections] = await Promise.all([
      getCandidateEvidenceMetaMap(candidateIds),
      getCandidateVideoMetaMap(candidates.map((c) => ({ id: c.id, slug: c.slug }))),
      getCandidatePromotionConflictMap(candidates.map((c) => ({ id: c.id, googlePlaceId: c.googlePlaceId }))),
      getApprovedHeroSelectionMapForCandidates(candidateIds),
    ]);
    const enriched = candidates.map((candidate) => {
      const websiteEvidenceMeta = evidenceMeta[candidate.id] ?? { total: 0, okDocs: 0, latestFetchedAt: null, stale: false };
      const video = videoMeta[candidate.id] ?? { total: 0, approvedOrAttached: 0 };
      const promotionConflict = promotionConflicts[candidate.id] ?? null;
      const heroMediaSelection = heroSelections[candidate.id] ?? null;
      const hasApprovedHeroSelection = Boolean(heroMediaSelection);
      return {
        ...candidate,
        adminUrl: adminUrl(req, "/admin/restaurants/candidates", { candidate: candidate.id }),
        websiteEvidenceMeta,
        videoMeta: video,
        promotionConflict,
        heroMediaSelection,
        hasApprovedHeroSelection,
        readiness: computeCandidateReadiness({
          ...candidate,
          hasApprovedHeroSelection,
          websiteEvidenceOkDocs: websiteEvidenceMeta.okDocs,
          videoCandidateCount: video.total,
          approvedOrAttachedVideoCount: video.approvedOrAttached,
          promotionConflict: promotionConflict?.conflict ?? null,
        }),
      };
    });
    return adminJson({ candidates: enriched, adminScope: auth.scope });
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
  body = split.body;
  const audit = auditContext(auth, { reason: split.reason });

  const parsed = validateCandidateBody(body, "create");
  if (!parsed.ok) return validationError(parsed.errors);
  const write = parsed.value;
  const warnings: unknown[] = [...parsed.warnings];

  try {
    if (write.googlePlaceId) {
      const existing = await findPlaceIdConflict(write.googlePlaceId);
      if (existing) {
        return adminError(409, "place_id_conflict", `A ${existing.kind} (“${existing.name}”) already uses this Google Place ID.`, {
          field: "googlePlaceId",
          existing: {
            kind: existing.kind, id: existing.id, name: existing.name, slug: existing.slug, status: existing.status, market: existing.market,
            adminUrl: existing.kind === "candidate" ? adminUrl(req, "/admin/restaurants/candidates", { candidate: existing.id }) : undefined,
          },
        });
      }
    }

    const index = await listIdentityRecords();
    const duplicateNotes = findPossibleDuplicates(
      { name: write.name!, address: write.address ?? null, market: write.market!, googlePlaceId: write.googlePlaceId ?? null },
      index,
    );
    warnings.push(...duplicateNotes.map((n) => ({ code: n.code, severity: n.severity, message: n.message, existing: n.existing })));

    const used = await getExistingCandidateSlugs();
    let slug = write.slug ?? null;
    if (slug && used.has(slug)) {
      return adminError(409, "slug_conflict", `Another candidate already uses the slug "${slug}".`, { field: "slug" });
    }
    if (!slug) {
      const base = slugify(write.name!) || "restaurant";
      slug = base;
      for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    }

    const candidate = await insertCandidateRestaurant({
      ...write,
      slug,
      status: write.status ?? "needs_review",
      source: "manual",
    }, audit);
    if (!candidate) return adminError(422, "invalid_candidate", "Invalid candidate data.");
    // Provenance, kept separate from curated fields (best-effort).
    await addRestaurantSource(candidate.id, {
      sourceType: "manual",
      externalId: candidate.googlePlaceId,
      rawName: write.name ?? null,
      rawAddress: write.address ?? null,
      url: write.websiteDomain ?? null,
      notes: write.reviewNotes ?? null,
    });
    return adminJson(
      { candidate, id: candidate.id, adminUrl: adminUrl(req, "/admin/restaurants/candidates", { candidate: candidate.id }), warnings },
      201,
    );
  } catch {
    // A lost race on the Place ID unique index looks like any other insert failure: re-check before giving up.
    if (write.googlePlaceId) {
      try {
        const existing = await findPlaceIdConflict(write.googlePlaceId);
        if (existing) {
          return adminError(409, "place_id_conflict", `A ${existing.kind} (“${existing.name}”) already uses this Google Place ID.`, {
            field: "googlePlaceId",
            existing: { kind: existing.kind, id: existing.id, name: existing.name, slug: existing.slug, status: existing.status, market: existing.market },
          });
        }
      } catch { /* fall through to the generic error */ }
    }
    return adminError(500, "create_failed", "Could not create the candidate. Nothing was confirmed; check for it before retrying.", { retryable: false });
  }
}
