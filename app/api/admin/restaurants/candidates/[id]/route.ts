import { adminError, adminJson, candidateReviewUrl, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { splitAuditReason } from "@/lib/adminAudit";
import { DRAFT_STATUSES, validateCandidateBody } from "@/lib/adminValidation";
import { findPossibleDuplicates } from "@/lib/duplicateWarnings";
import { getCandidateRestaurant, getExistingCandidateSlugs, updateCandidateRestaurant } from "@/lib/db/candidates";
import { findPlaceIdConflict, getPromotedRestaurantForCandidate, listIdentityRecords } from "@/lib/db/identity";

/*
  PATCH /api/admin/restaurants/candidates/[id]  (INTERNAL, admin credential required)

  Strict, additive update of a candidate. Never publishes to `/feed`.
   - Unknown fields, invalid status/market/price/tags/coordinates -> 422 with per-field errors
     (the previous behaviour silently ignored them and still returned 200).
   - `market` may be corrected until the candidate is promoted (409 `already_promoted` afterwards).
   - A Google Place ID or slug already used elsewhere -> 409.
   - The DRAFT credential may only set status candidate|needs_review, and may not edit a candidate that is
     already approved (403). Approving and rejecting need the publication credential.
  200 -> { candidate (the persisted row), id, adminUrl, changedFields, warnings }.
*/
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const { id } = await params;
  try {
    const before = await getCandidateRestaurant(id);
    if (!before) return adminError(404, "not_found", "Candidate not found.");

    const parsed = validateCandidateBody(body, "patch", {
      existingMarket: before.market,
      existingLat: before.lat,
      existingLng: before.lng,
    });
    if (!parsed.ok) return validationError(parsed.errors);
    const write = parsed.value;

    if (auth.scope === "draft") {
      if (before.status === "approved") {
        return adminError(403, "draft_cannot_edit_approved", "A draft credential cannot edit a candidate that has been approved; use the publication credential.", {
          requiredScope: "publish", credentialScope: "draft",
        });
      }
      if (write.status && !(DRAFT_STATUSES as readonly string[]).includes(write.status)) {
        return adminError(403, "insufficient_scope", "A draft credential cannot approve or reject candidates; it may only set candidate or needs_review.", {
          field: "status", requiredScope: "publish", credentialScope: "draft",
        });
      }
    }

    if (write.market && write.market !== before.market) {
      const promoted = await getPromotedRestaurantForCandidate(id);
      if (promoted) {
        return adminError(409, "already_promoted", `The market cannot change after publication (published as /${promoted.slug}).`, {
          field: "market", restaurantSlug: promoted.slug,
        });
      }
    }
    if (write.googlePlaceId && write.googlePlaceId !== before.googlePlaceId) {
      const existing = await findPlaceIdConflict(write.googlePlaceId, id);
      if (existing) {
        return adminError(409, "place_id_conflict", `A ${existing.kind} (“${existing.name}”) already uses this Google Place ID.`, {
          field: "googlePlaceId",
          existing: { kind: existing.kind, id: existing.id, name: existing.name, slug: existing.slug, status: existing.status, market: existing.market },
        });
      }
    }
    if (write.slug && write.slug !== before.slug) {
      const used = await getExistingCandidateSlugs();
      if (used.has(write.slug)) {
        return adminError(409, "slug_conflict", `Another candidate already uses the slug "${write.slug}".`, { field: "slug" });
      }
    }

    const warnings: unknown[] = [...parsed.warnings];
    if (write.name || write.address !== undefined || write.market) {
      const index = await listIdentityRecords();
      const notes = findPossibleDuplicates(
        { name: write.name ?? before.name, address: write.address !== undefined ? write.address : before.address, market: write.market ?? before.market, googlePlaceId: write.googlePlaceId ?? before.googlePlaceId, excludeId: id },
        index,
      );
      warnings.push(...notes.map((n) => ({ code: n.code, severity: n.severity, message: n.message, existing: n.existing })));
    }

    const candidate = await updateCandidateRestaurant(id, write, audit);
    if (!candidate) return adminError(404, "not_found", "Candidate not found.");
    const changedFields = Object.keys(write).filter(
      (key) => JSON.stringify((before as unknown as Record<string, unknown>)[key]) !== JSON.stringify((candidate as unknown as Record<string, unknown>)[key]),
    );
    return adminJson({
      candidate,
      id: candidate.id,
      adminUrl: candidateReviewUrl(req, candidate.id),
      changedFields,
      warnings,
    });
  } catch {
    return adminError(500, "update_failed", "Failed to update candidate. Re-read the record before retrying.", { retryable: true });
  }
}
