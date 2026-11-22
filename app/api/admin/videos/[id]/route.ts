import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { readOptionalReason } from "@/lib/adminAudit";
import { hideVideo } from "@/lib/db/videos";

/*
  DELETE /api/admin/videos/[id]  (internal, publication credential, v1.2)
  Soft-delete only: sets status = "hidden". Never hard-deletes. Idempotent. Writes one audit event, in the
  same statement as the change, when the status actually changes. Optional body: { "auditReason": "why" }.
*/
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
