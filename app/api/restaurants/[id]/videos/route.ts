import { getAppRestaurantById } from "@/lib/db/restaurants";
import { getActiveVideos } from "@/lib/db/videos";

/*
  GET /api/restaurants/[id]/videos  (public read, v1.2)
  Returns active persisted videos for a seed OR published DB restaurant,
  normalized through lib/video. Published restaurants have no attached videos
  yet (promotion never auto-publishes videos), so this returns []. Degrades
  gracefully: if the DB is down/unset it returns an empty list rather than
  failing the profile.
*/
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!(await getAppRestaurantById(id))) {
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
