import { getRestaurantById } from "@/lib/seed/restaurants";
import { normalizeVideo } from "@/lib/video";
import { auditContext, guardAdmin } from "@/lib/adminGuard";
import { insertVideo, listVideosForAdmin } from "@/lib/db/videos";
import { adminError, adminJson } from "@/lib/adminApi";

/*
  GET /api/admin/videos?restaurant=<slug>&status=active|hidden&limit=<1-200>  (PUBLICATION credential)
  Published videos, ACTIVE AND HIDDEN, for the correction / recovery screen. Source identity is read-only.
*/
export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  if (status !== null && status !== "active" && status !== "hidden") {
    return adminError(422, "invalid_status", "status must be active or hidden.", { field: "status" });
  }
  const limit = params.get("limit") === null ? 100 : Number(params.get("limit"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return adminError(422, "invalid_limit", "limit must be an integer from 1 to 200.", { field: "limit" });
  }
  try {
    const videos = await listVideosForAdmin({ restaurantSlug: params.get("restaurant")?.trim() || undefined, status: status ?? undefined, limit });
    return adminJson({ videos });
  } catch {
    return adminError(500, "list_failed", "Could not list videos.", { retryable: true });
  }
}

/*
  POST /api/admin/videos  (internal, admin-secret protected, v1.2)
  Body: { restaurantId: string, video: Video-compatible }
  - requires x-foodswipe-admin-secret header == FOODSWIPE_ADMIN_SECRET
  - restaurantId must exist in seed restaurants
  - video is cleaned by normalizeVideo (rejects junk; enforces legal-safe rules)
  - inserts into Postgres; returns the saved Video
*/
export async function POST(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const restaurantId = typeof b.restaurantId === "string" ? b.restaurantId : "";
  if (!getRestaurantById(restaurantId)) {
    return Response.json({ error: "Unknown restaurant." }, { status: 400 });
  }

  const video = normalizeVideo(b.video);
  if (!video) {
    return Response.json({ error: "Invalid video data." }, { status: 422 });
  }

  try {
    const saved = await insertVideo(restaurantId, video, auditContext(auth));
    return Response.json({ video: saved }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to save video." }, { status: 500 });
  }
}
