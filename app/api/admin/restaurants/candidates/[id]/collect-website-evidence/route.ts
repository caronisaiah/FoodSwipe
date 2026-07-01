import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured } from "@/lib/db/candidates";
import { getEvidenceMeta, saveEvidenceForSubject } from "@/lib/db/restaurantEvidence";
import { collectWebsiteEvidence } from "@/lib/websiteEvidence";

const NO_STORE = { "Cache-Control": "no-store" };

/*
  POST /api/admin/restaurants/candidates/[id]/collect-website-evidence  (INTERNAL, admin-secret)

  Tag Automation B4 — admin-triggered, BOUNDED official-website evidence collection
  for a candidate. Fetches only the candidate's own stored domain (or an
  admin-supplied SAME-DOMAIN url), cleans the text, and stores it in
  `restaurant_evidence_documents`. SSRF-reduced, https-only, <=3 pages, short
  timeouts, capped text; social/review/search domains rejected; no media/JS/login.
  Writes ONLY the evidence table — never tags/profile. Guards: 503 no secret · 401
  bad secret · 503 no DB · 404 unknown candidate. `no-store`.

  Body (optional): { url?: string }  // a specific same-domain page to start from.
*/
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params;
  const candidate = await getCandidateRestaurant(id);
  if (!candidate) {
    return Response.json({ error: "Candidate not found." }, { status: 404, headers: NO_STORE });
  }

  let adminUrl: string | null = null;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (body && typeof body.url === "string") adminUrl = body.url;
  } catch {
    // body is optional
  }

  if (!candidate.websiteDomain) {
    return Response.json(
      { error: "This candidate has no official website domain on file. Add one first." },
      { status: 422, headers: NO_STORE },
    );
  }

  const collected = await collectWebsiteEvidence({ domain: candidate.websiteDomain, adminUrl });
  const subject = { type: "candidate" as const, candidateRestaurantId: candidate.id };
  let saved = 0;
  try {
    saved = await saveEvidenceForSubject(
      subject,
      candidate.market,
      collected.documents,
    );
  } catch {
    return Response.json({ error: "Failed to store evidence." }, { status: 500, headers: NO_STORE });
  }
  const evidenceMeta = await getEvidenceMeta(subject);

  return Response.json(
    {
      restaurant: { id: candidate.id, name: candidate.name, kind: "candidate" },
      domain: candidate.websiteDomain,
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
