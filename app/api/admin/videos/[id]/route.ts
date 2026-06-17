import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { hideVideo, isDbConfigured } from "@/lib/db/videos";

/*
  DELETE /api/admin/videos/[id]  (internal, admin-secret protected, v1.2)
  Soft-delete only: sets status = "hidden". Never hard-deletes.
*/
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin writes are disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503 },
    );
  }

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
