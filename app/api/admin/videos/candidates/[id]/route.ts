import { adminError, adminJson, adminUrl, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { splitAuditReason } from "@/lib/adminAudit";
import { DRAFT_VIDEO_STATUSES, validateVideoCandidateBody } from "@/lib/adminVideoValidation";
import { getCandidateRef, getPublishedRefBySlug } from "@/lib/db/identity";
import { getAssociationSummaries, getVideoCandidate, patchVideoCandidate, type VideoCandidatePatch } from "@/lib/db/videoCandidates";
import { resolveAssociation } from "@/lib/videoAssociation";

/*
  PATCH /api/admin/videos/candidates/[id]  (INTERNAL, admin credential required)

  Strict edit of review fields only. Immutable source identity (URL, platform, video id, embed URL,
  legal status, resolver output) cannot be written. Unknown fields, invalid status, handle, confidence
  or restaurant references -> 422 per-field errors (no silent no-ops).

  Association: sending `candidateRestaurantId` and/or `restaurantSlug` REPLACES the whole association
  (the one you omit is cleared) and is re-validated: the reference must exist, a slug must be a
  published restaurant, and two references must point at the same restaurant in the same market.

  The DRAFT credential may only edit candidates that are still `needs_review` and may only leave them
  `needs_review`: approving, rejecting or editing an approved candidate needs the publication credential.
  An attached candidate is locked (409).
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
    const before = await getVideoCandidate(id);
    if (!before) return adminError(404, "not_found", "Candidate not found.");
    if (before.status === "attached" || before.attachedVideoId) {
      return adminError(409, "attached_locked", "Review edits are locked for attached candidates.");
    }

    const parsed = validateVideoCandidateBody(body, "patch");
    if (!parsed.ok) return validationError(parsed.errors);
    const w = parsed.value;

    if (auth.scope === "draft") {
      if (before.status !== "needs_review") {
        return adminError(403, "draft_cannot_edit_reviewed", `A draft credential cannot edit a candidate that is ${before.status}; use the publication credential.`, {
          requiredScope: "publish", credentialScope: "draft",
        });
      }
      if (w.status && !(DRAFT_VIDEO_STATUSES as readonly string[]).includes(w.status)) {
        return adminError(403, "insufficient_scope", "A draft credential cannot approve or reject video candidates.", {
          field: "status", requiredScope: "publish", credentialScope: "draft",
        });
      }
    }

    const patch: VideoCandidatePatch = { ...w };
    if ("candidateRestaurantId" in w || "restaurantSlug" in w) {
      const association = await resolveAssociation(
        { candidateRestaurantId: "candidateRestaurantId" in w ? w.candidateRestaurantId : null, restaurantSlug: "restaurantSlug" in w ? w.restaurantSlug : null },
        { candidateById: getCandidateRef, publishedBySlug: getPublishedRefBySlug },
      );
      if (!association.ok) return validationError([{ field: association.field, code: association.code, message: association.message }]);
      patch.candidateRestaurantId = association.candidateRestaurantId;
      patch.restaurantSlug = association.restaurantSlug;
    }

    const result = await patchVideoCandidate(id, patch, audit);
    if (!result.ok) {
      return result.code === "attached"
        ? adminError(409, "attached_locked", "Review edits are locked for attached candidates.")
        : adminError(404, "not_found", "Candidate not found.");
    }
    const candidate = result.candidate;
    const summaries = await getAssociationSummaries([candidate]);
    const changedFields = Object.keys(patch).filter(
      (key) => JSON.stringify((before as unknown as Record<string, unknown>)[key]) !== JSON.stringify((candidate as unknown as Record<string, unknown>)[key]),
    );
    return adminJson({
      candidate, id: candidate.id, adminUrl: adminUrl(req, "/admin/videos/candidates", { candidate: candidate.id }),
      association: summaries[candidate.id] ?? null, changedFields,
    });
  } catch {
    return adminError(500, "update_failed", "Failed to update candidate. Re-read the record before retrying.", { retryable: true });
  }
}
