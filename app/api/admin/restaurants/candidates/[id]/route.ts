import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { isDbConfigured, updateCandidateRestaurant } from "@/lib/db/candidates";

/*
  PATCH /api/admin/restaurants/candidates/[id]  (internal, admin-secret protected)
  Additive update of a candidate restaurant — only fields present in the body are
  written (including `status` for review transitions: candidate | approved |
  rejected | needs_review). Never publishes to `/feed`; this is review staging.
*/
export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const candidate = await updateCandidateRestaurant(id, body);
    if (!candidate) {
      return Response.json({ error: "Candidate not found." }, { status: 404 });
    }
    return Response.json({ candidate });
  } catch {
    return Response.json({ error: "Failed to update candidate." }, { status: 500 });
  }
}
