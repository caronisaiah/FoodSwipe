import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured, type CandidateRestaurant } from "@/lib/db/candidates";
import {
  clearApprovedHeroSelectionForCandidate,
  getApprovedHeroSelectionForCandidate,
  upsertApprovedHeroSelectionForCandidate,
  validHeroPhotoOrdinal,
} from "@/lib/db/heroMediaSelections";
import { getPlacePhotoByOrdinal, type PlacePhotoStatus } from "@/lib/places";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errorForStatus(status: PlacePhotoStatus): string {
  if (status === "missing-api-key") return "Google Maps API key is not configured.";
  if (status === "missing-google-place-id") return "Candidate has no Google Place ID.";
  if (status === "place-details-failed") return "Google Place Details request failed.";
  if (status === "no-photos") return "Google returned no photos for this exact Place ID.";
  if (status === "invalid-photo-ordinal") return "Selected photo ordinal is unavailable for this Place ID.";
  if (status === "photo-media-failed") return "Google photo media request failed.";
  return "Google selected-photo lookup failed.";
}

function httpStatusFor(status: PlacePhotoStatus): number {
  if (status === "missing-api-key") return 503;
  if (
    status === "place-details-failed" ||
    status === "photo-media-failed" ||
    status === "error"
  ) {
    return 502;
  }
  return 422;
}

type CandidateGuardResult =
  | { ok: false; response: Response }
  | { ok: true; candidate: CandidateRestaurant };

async function guardCandidate(req: Request, id: string): Promise<CandidateGuardResult> {
  if (!isAdminConfigured()) {
    return { ok: false, response: json({ error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." }, 503) };
  }
  if (!hasValidAdminSecret(req)) {
    return { ok: false, response: json({ error: "Unauthorized." }, 401) };
  }
  if (!isDbConfigured()) {
    return { ok: false, response: json({ error: "Database not configured (DATABASE_URL not set)." }, 503) };
  }
  const candidate = await getCandidateRestaurant(id);
  if (!candidate) {
    return { ok: false, response: json({ error: "Candidate not found." }, 404) };
  }
  return { ok: true, candidate };
}

/*
  GET/PUT/DELETE /api/admin/restaurants/candidates/[id]/hero-media-selection

  INTERNAL, admin-secret, no-store. Persists only exact-location Google Place ID
  + 1-based photo ordinal approval metadata. Never stores Google photo names,
  ephemeral photoUri values, image bytes, or API keys.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const guarded = await guardCandidate(req, id);
  if (!guarded.ok) return guarded.response;
  const { candidate } = guarded;
  const selection = await getApprovedHeroSelectionForCandidate(candidate.id);

  if (!candidate.googlePlaceId) {
    return json({
      error: "Candidate has no Google Place ID.",
      status: "missing-google-place-id",
      candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
      selection,
      preview: null,
    });
  }

  if (!selection) {
    return json({
      status: "no-selection",
      candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
      selection: null,
      preview: null,
    });
  }

  if (selection.sourcePlaceId !== candidate.googlePlaceId) {
    return json({
      error: "Approved hero selection no longer matches this candidate's Google Place ID.",
      status: "source-place-mismatch",
      candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
      selection,
      preview: null,
    });
  }

  const preview = await getPlacePhotoByOrdinal(selection.sourcePlaceId, selection.selectedPhotoOrdinal);
  return json({
    error: preview.photo ? undefined : errorForStatus(preview.status),
    status: preview.status,
    candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
    selection,
    preview: {
      photo: preview.photo,
      status: preview.status,
      httpStatus: preview.httpStatus,
      googleStatus: preview.googleStatus,
    },
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const guarded = await guardCandidate(req, id);
  if (!guarded.ok) return guarded.response;
  const { candidate } = guarded;
  if (!candidate.googlePlaceId) {
    return json({ error: "Candidate has no Google Place ID." }, 422);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const sourcePlaceId = cleanString(body.sourcePlaceId);
  if (!sourcePlaceId) return json({ error: "sourcePlaceId is required." }, 400);
  if (sourcePlaceId !== candidate.googlePlaceId) {
    return json({ error: "sourcePlaceId must match the candidate Google Place ID for P2C." }, 400);
  }

  const selectedPhotoOrdinal = validHeroPhotoOrdinal(body.selectedPhotoOrdinal);
  if (!selectedPhotoOrdinal) {
    return json({ error: "selectedPhotoOrdinal must be an integer from 1 to 10." }, 400);
  }

  const preview = await getPlacePhotoByOrdinal(sourcePlaceId, selectedPhotoOrdinal);
  if (!preview.photo) {
    return json(
      {
        error: errorForStatus(preview.status),
        status: preview.status,
        httpStatus: preview.httpStatus,
        googleStatus: preview.googleStatus,
      },
      httpStatusFor(preview.status),
    );
  }

  const selection = await upsertApprovedHeroSelectionForCandidate({
    candidateRestaurantId: candidate.id,
    sourcePlaceId,
    selectedPhotoOrdinal,
    reviewerNotes: cleanString(body.reviewerNotes),
    selectionReason:
      cleanString(body.selectionReason) ?? "Selected from exact-location Google photo candidates",
  });

  return json({
    status: "ok",
    candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
    selection,
    preview: {
      photo: preview.photo,
      status: preview.status,
      httpStatus: preview.httpStatus,
      googleStatus: preview.googleStatus,
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const guarded = await guardCandidate(req, id);
  if (!guarded.ok) return guarded.response;
  const { candidate } = guarded;
  const clearedCount = await clearApprovedHeroSelectionForCandidate(candidate.id);
  return json({
    status: "cleared",
    candidate: { id: candidate.id, googlePlaceId: candidate.googlePlaceId },
    selection: null,
    clearedCount,
  });
}
