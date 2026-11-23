import assert from "node:assert/strict";
import { buildMapping } from "./lib/video-association-mapping.mjs";
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const cand = (id, name, slug, over = {}) => ({ id, name, slug, market: "nyc", status: "needs_review", address: "x", promotionConflict: null, ...over });
const restaurants = [cand("c-semma", "Semma", "semma"), cand("c-thai", "Thai Diner", "thai-diner"), cand("c-dhamaka", "Dhamaka", "dhamaka"), cand("c-dc-semma", "Semma", "semma", { market: "dc" }), cand("c-rej", "Rejected", "rejected-place", { status: "rejected" }), cand("c-live", "Live", "live-place", { promotionConflict: { conflict: "already-promoted", restaurantSlug: "live-place-2" } })];
const v = (id, slug, over = {}) => ({ id, sourceUrl: `https://www.tiktok.com/@a/video/${id}`, status: "needs_review", creatorHandle: "@a", restaurantSlug: slug, candidateRestaurantId: null, ...over });
const rows = buildMapping(restaurants.filter((r) => r.id !== "c-dc-semma"), [v("1", "semma"), v("2", "thai-diner"), v("3", "dhamaka"), v("4", "typo"), v("5", "rejected-place"), v("6", "live-place"), v("7", null), v("8", "semma", { candidateRestaurantId: "c-semma" })]);
eq(rows.map((r) => r.action), ["link-by-id", "link-by-id", "link-by-id", "needs-review", "needs-review", "needs-review", "no-link", "already-linked-by-id"]);
eq(rows.slice(0, 3).map((r) => r.proposedCandidateRestaurantId), ["c-semma", "c-thai", "c-dhamaka"]);
eq(rows.every((r) => r.approved !== true), true, "nothing is pre-approved");
eq(rows[3].notes[0].includes('no restaurant candidate has the slug "typo"'), true);
eq(rows[5].notes[0].includes("already published"), true);
// an ambiguous slug (same slug in two markets) is never auto-linked
const amb = buildMapping(restaurants, [v("9", "semma")]);
eq([amb[0].action, amb[0].proposedCandidateRestaurantId, amb[0].notes[0].includes("2 restaurant candidates share")], ["needs-review", null, true]);
console.log(`Association mapping checks passed (${checks} assertions).`);
