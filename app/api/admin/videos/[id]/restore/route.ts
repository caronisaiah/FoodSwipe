import { adminError, adminJson } from "@/lib/adminApi";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { readOptionalReason } from "@/lib/adminAudit";
import { restoreVideo } from "@/lib/db/videos";

/*
  POST /api/admin/videos/[id]/restore  (INTERNAL, PUBLICATION credential only)

  Recovery for a video that was hidden (the soft delete behind DELETE /api/admin/videos/[id]). The row was
  never deleted, so its source identity, attribution and restaurant association are exactly as they were;
  this only flips status hidden -> active. Idempotent: restoring an active video returns it with
  `changed: false` and writes no audit event. A successful restore writes one `restaurant_video.restored`
  event in the same statement. Optional body: { "auditReason": "why" }.
*/
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;
  const reason = await readOptionalReason(req);
  if (!reason.ok) return adminError(400, "invalid_reason", reason.message);

  const { id } = await params;
  try {
    const result = await restoreVideo(id, auditContext(auth, { reason: reason.reason }));
    if (!result) return adminError(404, "not_found", "Video not found.");
    return adminJson({ video: result.video, changed: result.changed, requestId: auth.requestId });
  } catch {
    return adminError(500, "restore_failed", "Could not restore the video. Nothing was changed; re-read it before retrying.", { retryable: true });
  }
}
