import {
  buildYouTubeVideo,
  fetchYouTubeMetadata,
  resolveYouTubeUrl,
} from "@/lib/youtube";

/*
  POST /api/resolve/youtube  (internal)
  -------------------------------------
  Body: { url: string, creatorHandle?, creatorDisplayName?, caption? }
  Returns: { video, metadataStatus } or { error }.

  Server-side so client input is never trusted. The URL is validated and the
  Video is normalized via lib/video. If YOUTUBE_API_KEY is set we additionally
  fetch official metadata (videos.list) to prefill title/channel/thumbnail/date
  — best-effort, with `metadataStatus` reporting the outcome. We only ever
  produce a youtube-nocookie embed URL; no scraping, downloading, or rehosting.
*/

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const url = typeof b.url === "string" ? b.url : "";
  if (url.trim() === "") {
    return Response.json({ error: "Missing 'url'." }, { status: 400 });
  }

  const resolved = resolveYouTubeUrl(url);
  if (!resolved) {
    return Response.json(
      { error: "Not a valid YouTube video URL (expected watch / youtu.be / shorts / embed)." },
      { status: 422 },
    );
  }

  // Optional enrichment — falls back gracefully (missing key / not-found / failed).
  const { status: metadataStatus, metadata } = await fetchYouTubeMetadata(
    resolved.videoId,
  );

  const video = buildYouTubeVideo({
    url,
    creatorHandle: typeof b.creatorHandle === "string" ? b.creatorHandle : undefined,
    creatorDisplayName:
      typeof b.creatorDisplayName === "string" ? b.creatorDisplayName : undefined,
    caption: typeof b.caption === "string" ? b.caption : undefined,
    metadata,
  });

  if (!video) {
    return Response.json({ error: "Could not build video." }, { status: 422 });
  }

  return Response.json({ video, metadataStatus });
}
