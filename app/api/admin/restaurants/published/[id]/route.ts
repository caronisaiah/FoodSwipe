import { adminError, adminJson, adminUrl, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { splitAuditReason } from "@/lib/adminAudit";
import { validatePublishedPatch } from "@/lib/adminValidation";
import { updatePublishedRestaurant } from "@/lib/db/restaurants";

/*
  PATCH /api/admin/restaurants/published/[id]  (INTERNAL, PUBLICATION credential only)

  Edit a DB-published restaurant by its uuid. Strict: unknown fields, an unchangeable field (market,
  slug, id, sourceCandidateId), invalid status/price/tags/coordinates -> 422 with per-field errors; a
  Google Place ID already used by another restaurant -> 409. Editable: name, neighborhood, address,
  websiteDomain, googlePlaceId, lat, lng, priceLevel, cuisineTags, dietaryTags, vibeTags, bestFor,
  dishHighlights, reasonText, status (published|hidden).
  A draft credential is refused (403): editing live records is a publication action.
  Required feed fields are never cleared below the promotion minimum (unchanged). Changes appear on the
  next runtime feed read (no-store API).
*/
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
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
  const parsed = validatePublishedPatch(split.body);
  if (!parsed.ok) return validationError(parsed.errors);

  const { id } = await params;
  try {
    const restaurant = await updatePublishedRestaurant(id, parsed.value, audit);
    if (!restaurant) return adminError(404, "not_found", "Published restaurant not found.");
    return adminJson({ restaurant, id: restaurant.id, adminUrl: adminUrl(req, "/admin/restaurants/published"), warnings: parsed.warnings });
  } catch {
    // Most likely a unique-index conflict (e.g. editing googlePlaceId to one already used elsewhere).
    return adminError(409, "update_conflict", "Failed to update (possibly a duplicate Google Place ID).");
  }
}
