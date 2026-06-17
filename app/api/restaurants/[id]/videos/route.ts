import { getRestaurantById } from "@/lib/seed/restaurants";
import { getActiveVideos } from "@/lib/db/videos";

/*
  GET /api/restaurants/[id]/videos  (public read, v1.2)
  Returns active persisted videos for a seeded restaurant, normalized through
  lib/video. Degrades gracefully: if the DB is down/unset it returns an empty
  list (seed videos still render client-side) rather than failing the profile.
*/
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!getRestaurantById(id)) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }
  try {
    const videos = await getActiveVideos(id);
    return Response.json({ videos });
  } catch {
    // Don't break the profile if the video store is unavailable.
    return Response.json(
      { videos: [], error: "Video store temporarily unavailable." },
      { status: 200 },
    );
  }
}
