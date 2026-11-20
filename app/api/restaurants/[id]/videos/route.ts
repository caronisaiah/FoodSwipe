import { getAppRestaurantById } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { getActiveVideos } from "@/lib/db/videos";

/*
  GET /api/restaurants/[id]/videos  (public read, v1.2)
  Returns active persisted videos for a visible public restaurant, normalized
  through lib/video. In production content mode, seed-only restaurant ids do not
  resolve. Published restaurants have no attached videos yet (promotion never
  auto-publishes videos), so this returns []. Degrades
  gracefully: if the DB is down/unset it returns an empty list rather than
  failing the profile.

  Caching: NONE, on every response. A 404 must not outlive a publication change,
  and the empty list returned during an outage must not be served after the
  video store recovers.
*/
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!(await getAppRestaurantById(id, { includeSeeds: shouldIncludeSeedRestaurants() }))) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404, headers: NO_STORE });
  }
  try {
    const videos = await getActiveVideos(id);
    return Response.json({ videos }, { headers: NO_STORE });
  } catch {
    // Don't break the profile if the video store is unavailable.
    return Response.json(
      { videos: [], error: "Video store temporarily unavailable." },
      { status: 200, headers: NO_STORE },
    );
  }
}
