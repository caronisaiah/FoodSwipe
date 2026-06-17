import { buildYouTubeVideo } from "@/lib/youtube";

/*
  POST /api/resolve/youtube  (internal, v1.1)
  -------------------------------------------
  Body: { url: string, creatorHandle?, creatorDisplayName?, caption? }
  Returns: { video } (a normalized, legal-safe, embeddable Video) or { error }.

  Server-side so client input is never trusted: the URL is validated + the
  Video is built and run through lib/video's normalizeVideo here. We only ever
  produce a youtube-nocookie embed URL, store nothing, and use no API key.
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

  const video = buildYouTubeVideo({
    url,
    creatorHandle: typeof b.creatorHandle === "string" ? b.creatorHandle : undefined,
    creatorDisplayName:
      typeof b.creatorDisplayName === "string" ? b.creatorDisplayName : undefined,
    caption: typeof b.caption === "string" ? b.caption : undefined,
  });

  if (!video) {
    return Response.json(
      { error: "Not a valid YouTube video URL (expected watch / youtu.be / shorts / embed)." },
      { status: 422 },
    );
  }

  return Response.json({ video });
}
