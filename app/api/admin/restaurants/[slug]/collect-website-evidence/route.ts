import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured } from "@/lib/db/candidates";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { getEvidenceMeta, saveEvidenceForSubject } from "@/lib/db/restaurantEvidence";
import { collectWebsiteEvidence } from "@/lib/websiteEvidence";

const NO_STORE = { "Cache-Control": "no-store" };

/*
  POST /api/admin/restaurants/[slug]/collect-website-evidence  (INTERNAL, admin-secret)

  Tag Automation B4 — admin-triggered, BOUNDED official-website evidence collection
  for a published (or seed) restaurant resolved by slug. Same bounds + SSRF reductions
  as the candidate route; writes ONLY the evidence table. Guards: 503 no secret ·
  401 bad secret · 503 no DB (storing evidence requires a DB) · 404 unknown. `no-store`.

  Body (optional): { url?: string }  // a specific same-domain page to start from.
*/
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503, headers: NO_STORE },
    );
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404, headers: NO_STORE });
  }

  let adminUrl: string | null = null;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (body && typeof body.url === "string") adminUrl = body.url;
  } catch {
    // body is optional
  }

  if (!restaurant.websiteDomain) {
    return Response.json(
      { error: "This restaurant has no official website domain on file. Add one first." },
      { status: 422, headers: NO_STORE },
    );
  }

  const collected = await collectWebsiteEvidence({ domain: restaurant.websiteDomain, adminUrl });
  const subject = { type: "restaurant" as const, restaurantSlug: restaurant.id };
  let saved = 0;
  try {
    saved = await saveEvidenceForSubject(
      subject,
      restaurant.market,
      collected.documents,
    );
  } catch {
    return Response.json({ error: "Failed to store evidence." }, { status: 500, headers: NO_STORE });
  }
  const evidenceMeta = await getEvidenceMeta(subject);

  return Response.json(
    {
      restaurant: { id: restaurant.id, name: restaurant.name, kind: "published" },
      domain: restaurant.websiteDomain,
      stored: saved,
      pagesFetched: collected.pagesFetched,
      okPages: collected.okPages,
      totalCleanedChars: collected.totalCleanedChars,
      evidenceMeta,
      warnings: collected.warnings,
      documents: collected.documents.map((d) => ({
        sourceUrl: d.sourceUrl,
        sourceType: d.sourceType,
        fetchStatus: d.fetchStatus,
        error: d.error,
        chars: d.cleanedText.length,
        title: d.title,
      })),
    },
    { status: 200, headers: NO_STORE },
  );
}
