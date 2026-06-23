import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured } from "@/lib/db/candidates";
import { resolveHeroMedia } from "@/lib/heroMedia";

/*
  GET /api/admin/restaurants/candidates/[id]/photo  (INTERNAL, admin-secret)

  Read-only hero-media preview for a review candidate, so the admin page can show
  the same Place Photo -> Logo.dev -> placeholder ladder live restaurants use.
  Uses the SHARED `resolveHeroMedia` helper with the candidate's googlePlaceId +
  websiteDomain, and returns the SAME shape as /api/restaurants/[id]/photo
  (`{ photo, status, logoUrl, httpStatus?, googleStatus? }`) so the client can
  reuse the hero preview logic.

  NEVER writes to the DB. NEVER persists the photoUri. NEVER proxies/rehosts the
  image. `no-store` (the ephemeral photoUri must not be cached). Guards mirror the
  other admin routes: 503 if FOODSWIPE_ADMIN_SECRET unset · 401 if header
  missing/wrong · 503 if DATABASE_URL unset · 404 if the candidate is unknown.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
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

  const { id } = await params;
  const candidate = await getCandidateRestaurant(id); // SELECT only — no writes
  if (!candidate) {
    return Response.json({ error: "Candidate not found." }, { status: 404 });
  }

  const media = await resolveHeroMedia({
    googlePlaceId: candidate.googlePlaceId,
    websiteDomain: candidate.websiteDomain,
  });

  return Response.json(
    {
      photo: media.photo,
      status: media.photoStatus,
      logoUrl: media.logoUrl,
      httpStatus: media.httpStatus,
      googleStatus: media.googleStatus,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
