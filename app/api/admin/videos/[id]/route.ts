import { guardAdmin } from "@/lib/adminGuard";
import { hideVideo } from "@/lib/db/videos";

/*
  DELETE /api/admin/videos/[id]  (internal, admin-secret protected, v1.2)
  Soft-delete only: sets status = "hidden". Never hard-deletes.
*/
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const hidden = await hideVideo(id);
    if (!hidden) {
      return Response.json({ error: "Video not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to hide video." }, { status: 500 });
  }
}
