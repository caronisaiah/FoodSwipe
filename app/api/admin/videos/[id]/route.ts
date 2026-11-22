import { adminError, adminJson, validationError } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { readOptionalReason, splitAuditReason } from "@/lib/adminAudit";
import { validateVideoCorrection } from "@/lib/adminVideoValidation";
import { getVideoForAdmin, hideVideo, updatePublishedVideo } from "@/lib/db/videos";

/*
  GET    /api/admin/videos/[id]  (PUBLICATION credential) read one published video, active or hidden.
  PATCH  /api/admin/videos/[id]  (PUBLICATION credential) correct creator handle, creator display name and/or
         attribution text. Nothing else can be changed: the source URL, platform, embed URL, caption, legal
         display status and the restaurant are refused by name (422), so a correction cannot re-point a video
         or loosen a display restriction. A change that alters nothing writes no audit event.
         200 -> { video, changed, requestId }. Optional `auditReason`.
  DELETE /api/admin/videos/[id]  (PUBLICATION credential) soft-delete only: status = "hidden". Never
         hard-deletes. Idempotent. Reverse it with POST /api/admin/videos/[id]/restore.
  Every successful change writes one audit event in the same statement as the change.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const video = await getVideoForAdmin(id);
    return video ? adminJson({ video }) : adminError(404, "not_found", "Video not found.");
  } catch {
    return adminError(500, "read_failed", "Could not read the video.", { retryable: true });
  }
}

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
  const parsed = validateVideoCorrection(split.body);
  if (!parsed.ok) return validationError(parsed.errors);

  const { id } = await params;
  try {
    const result = await updatePublishedVideo(id, parsed.value, auditContext(auth, { reason: split.reason }));
    if (!result) return adminError(404, "not_found", "Video not found.");
    return adminJson({ video: result.video, changed: result.changed, requestId: auth.requestId });
  } catch {
    return adminError(500, "update_failed", "Could not save the correction. Nothing was changed; re-read the video before retrying.", { retryable: true });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reason = await readOptionalReason(req);
  if (!reason.ok) return Response.json({ error: reason.message, code: "invalid_reason" }, { status: 400 });
  try {
    const hidden = await hideVideo(id, auditContext(auth, { reason: reason.reason }));
    if (!hidden) {
      return Response.json({ error: "Video not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to hide video." }, { status: 500 });
  }
}
