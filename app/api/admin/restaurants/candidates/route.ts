import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import {
  CANDIDATE_STATUSES,
  addRestaurantSource,
  insertCandidateRestaurant,
  isDbConfigured,
  listCandidateRestaurants,
  type CandidateStatus,
} from "@/lib/db/candidates";

/*
  Restaurant candidate ingestion (Phase 1) — INTERNAL, admin-secret protected.
  These routes manage a REVIEW staging area only; candidates never reach `/feed`
  (the app still serves seed restaurants). Same guards as /api/admin/videos:
    - 503 if FOODSWIPE_ADMIN_SECRET is unset (admin API disabled)
    - 401 if the x-foodswipe-admin-secret header is missing/wrong
    - 503 if DATABASE_URL is unset

  GET  /api/admin/restaurants/candidates[?status=candidate|approved|rejected|needs_review]
  POST /api/admin/restaurants/candidates   Body: manual candidate fields (name required)
*/

/** Shared guard — returns an error Response, or null when the request may proceed. */
function adminGuard(req: Request): Response | null {
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
  return null;
}

export async function GET(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;

  const statusParam = new URL(req.url).searchParams.get("status");
  const status: CandidateStatus | undefined =
    statusParam && (CANDIDATE_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as CandidateStatus)
      : undefined;

  try {
    const candidates = await listCandidateRestaurants(status);
    return Response.json({ candidates });
  } catch {
    return Response.json({ error: "Failed to list candidates." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (typeof b.name !== "string" || b.name.trim() === "") {
    return Response.json({ error: "A restaurant `name` is required." }, { status: 422 });
  }

  try {
    const candidate = await insertCandidateRestaurant(b);
    if (!candidate) {
      return Response.json({ error: "Invalid candidate data." }, { status: 422 });
    }
    // Record provenance separately from the curated candidate fields (best-effort).
    await addRestaurantSource(candidate.id, {
      sourceType: candidate.source,
      externalId: candidate.googlePlaceId,
      rawName: typeof b.name === "string" ? b.name : null,
      rawAddress: typeof b.address === "string" ? b.address : null,
      url: typeof b.websiteDomain === "string" ? b.websiteDomain : null,
      notes:
        typeof b.notes === "string"
          ? b.notes
          : typeof b.reviewNotes === "string"
            ? b.reviewNotes
            : null,
    });
    return Response.json({ candidate }, { status: 201 });
  } catch {
    return Response.json({ error: "Failed to create candidate." }, { status: 500 });
  }
}
