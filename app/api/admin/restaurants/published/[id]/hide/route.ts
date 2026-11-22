import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { readOptionalReason } from "@/lib/adminAudit";
import { hidePublishedRestaurant } from "@/lib/db/restaurants";

/*
  POST /api/admin/restaurants/published/[id]/hide  (INTERNAL, admin-secret)

  Convenience action: set a published restaurant's status to "hidden" so it stops
  serving to the feed (the row is kept, not deleted). Equivalent to PATCH with
  { status: "hidden" }. Guards: 503 no secret · 401 bad secret · 503 no DB · 404.
*/
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const reason = await readOptionalReason(req);
  if (!reason.ok) return Response.json({ error: reason.message, code: "invalid_reason" }, { status: 400 });
  try {
    const restaurant = await hidePublishedRestaurant(id, auditContext(auth, { reason: reason.reason }));
    if (!restaurant) {
      return Response.json({ error: "Published restaurant not found." }, { status: 404 });
    }
    return Response.json({ restaurant });
  } catch {
    return Response.json({ error: "Failed to hide restaurant." }, { status: 500 });
  }
}
