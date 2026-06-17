import { getRestaurantById } from "@/lib/seed/restaurants";
import { normalizeVideo } from "@/lib/video";
import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { insertVideo, isDbConfigured } from "@/lib/db/videos";

/*
  POST /api/admin/videos  (internal, admin-secret protected, v1.2)
  Body: { restaurantId: string, video: Video-compatible }
  - requires x-foodswipe-admin-secret header == FOODSWIPE_ADMIN_SECRET
  - restaurantId must exist in seed restaurants
  - video is cleaned by normalizeVideo (rejects junk; enforces legal-safe rules)
  - inserts into Postgres; returns the saved Video
*/
export async function POST(req: Request): Promise<Response> {
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
    const saved = await insertVideo(restaurantId, video);
    return Response.json({ video: saved }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to save video." }, { status: 500 });
  }
}
