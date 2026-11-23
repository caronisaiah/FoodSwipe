// Pure mapping from legacy slug-linked video candidates to restaurant-candidate ids.
// Used by scripts/admin-video-association-mapping.mjs. No I/O here.
export function buildMapping(restaurantCandidates, videoCandidates) {
  const rows = [];
  for (const v of videoCandidates) {
    const base = {
      videoCandidateId: v.id, sourceUrl: v.sourceUrl, videoStatus: v.status, creatorHandle: v.creatorHandle ?? null,
      currentRestaurantSlug: v.restaurantSlug ?? null, currentCandidateRestaurantId: v.candidateRestaurantId ?? null,
    };
    if (v.candidateRestaurantId) {
      const target = restaurantCandidates.find((c) => c.id === v.candidateRestaurantId);
      rows.push({ ...base, action: target ? "already-linked-by-id" : "needs-attention", proposedCandidateRestaurantId: v.candidateRestaurantId, notes: target ? [] : ["linked candidate id no longer exists"] });
      continue;
    }
    if (!v.restaurantSlug) { rows.push({ ...base, action: "no-link", proposedCandidateRestaurantId: null, notes: ["not linked to any restaurant"] }); continue; }
    const matches = restaurantCandidates.filter((c) => c.slug === v.restaurantSlug);
    const notes = [];
    if (matches.length === 0) notes.push(`no restaurant candidate has the slug "${v.restaurantSlug}"`);
    if (matches.length > 1) notes.push(`${matches.length} restaurant candidates share the slug "${v.restaurantSlug}" (markets: ${matches.map((m) => m.market).join(", ")})`);
    const only = matches.length === 1 ? matches[0] : null;
    if (only && only.status === "rejected") notes.push("the matching candidate is rejected");
    if (only && only.promotionConflict) notes.push(`already published as /${only.promotionConflict.restaurantSlug} (${only.promotionConflict.conflict})`);
    rows.push({
      ...base, action: only && notes.length === 0 ? "link-by-id" : "needs-review",
      proposedCandidateRestaurantId: only?.id ?? null, proposedCandidateName: only?.name ?? null,
      proposedCandidateMarket: only?.market ?? null, proposedCandidateStatus: only?.status ?? null, proposedCandidateAddress: only?.address ?? null,
      approved: false, notes,
    });
  }
  return rows;
}
