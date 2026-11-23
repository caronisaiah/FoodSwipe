// Admin Hardening C: unified restaurant review workspace.
//   1. pure logic (evidence stages, reviewer declarations, map readiness, publication checklist)
//   2. the real review route and the real admin routes on isolated PostgreSQL (PGlite), with data shaped like the
//      three Phase 16 restaurants and their eight slug-linked TikTok leads
//   3. static guards on the screens: nothing runs on page load, no billable call until a button is pressed,
//      one player at a time, publish actions gated and confirmed
// No network, no production, no real credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAppSandbox, createTestDatabase, root } from "./lib/pg-harness.mjs";

let checks = 0;
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => { assert.deepEqual(norm(a), norm(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const PUBLISH = "synthetic-publish-secret-0123456789";
const DRAFT = "synthetic-draft-secret-abcdefghij";
const ENV = { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT, FOODSWIPE_ADMIN_PUBLISH_LABEL: "ops-admin", FOODSWIPE_ADMIN_DRAFT_LABEL: "ingest-agent" };

const { client, db } = await createTestDatabase();
const sb = createAppSandbox(db, { env: ENV });
const review = sb.load("lib/adminReview.ts");

/* ====================== 1. pure logic ====================== */
{
  const base = { status: "needs_review", platform: "tiktok", platformVideoId: "7203", discoveredAt: "2026-11-20T10:00:00Z", resolverStatus: "resolved", resolverError: null, sourceFetchedAt: "2026-11-20T10:00:00Z", matchConfidence: 80, matchReasons: ["caption names the restaurant"], attachedVideoId: null };
  const ids = (stages) => stages.map((s) => s.id);
  const st = review.videoEvidenceStages(base, []);
  eq(ids(st), ["url_discovered", "metadata_verified", "restaurant_identified", "content_reviewed", "approved"], "five distinct stages, in order");
  eq(Object.fromEntries(st.map((s) => [s.id, s.state])), { url_discovered: "yes", metadata_verified: "yes", restaurant_identified: "not_recorded", content_reviewed: "not_recorded", approved: "no" }, "a fresh resolved lead: only the URL and metadata are established");
  ok(/Automated hints only, not a confirmation/.test(st[2].detail) && /80\/100/.test(st[2].detail), "automated match score and reasons are labelled as hints, not as a confirmation");
  ok(/audio, sponsorship and branch identity are not checked/i.test(st[3].detail), "the content stage says audio, sponsorship and branch identity are unchecked");
  eq(review.videoEvidenceStages({ ...base, resolverStatus: "source-link-only" }, [])[1].state, "partial", "link-only: metadata is only partly established");
  eq(review.videoEvidenceStages({ ...base, resolverStatus: "error", resolverError: "TikTok oEmbed HTTP 500" }, [])[1].state, "no", "a failed lookup is not verified");
  eq(review.videoEvidenceStages({ ...base, resolverStatus: "missing-credentials" }, [])[1].state, "no", "missing credentials is not verified");

  // reviewer declarations: recorded words, never a verified fact
  const reason = review.buildDeclarationReason({ watchedVideo: true, restaurantIdentified: true, note: "  Shows   the dosa   counter " });
  eq(reason, "Reviewer declaration: watched the video; restaurant identified. Note: Shows the dosa counter", "declaration text is stable and normalised");
  eq(review.parseDeclarationReason(reason), { watchedVideo: true, restaurantIdentified: true, note: "Shows the dosa counter" }, "a declaration round-trips");
  eq(review.parseDeclarationReason("Reviewer declaration: watched the video."), { watchedVideo: true, restaurantIdentified: false, note: null }, "partial declaration");
  eq(review.parseDeclarationReason("Looks right to me"), null, "ordinary text is not a declaration");
  eq(review.buildDeclarationReason({ watchedVideo: false, restaurantIdentified: false, note: "" }), undefined, "nothing ticked, nothing typed: no reason is invented");
  eq(review.buildDeclarationReason({ watchedVideo: false, restaurantIdentified: false, note: "just a note" }), "just a note", "a note alone is not turned into a declaration");
  ok(review.buildDeclarationReason({ watchedVideo: true, restaurantIdentified: true, note: "x".repeat(900) }).length < 600, "the note is bounded");
  const evs = [{ action: "video_candidate.approved", actorIdentity: "ops-admin", authScope: "publish", reason, occurredAt: "2026-11-21T12:00:00Z" }];
  const approvedStages = review.videoEvidenceStages({ ...base, status: "approved" }, evs);
  eq(Object.fromEntries(approvedStages.map((s) => [s.id, s.state])), { url_discovered: "yes", metadata_verified: "yes", restaurant_identified: "declared", content_reviewed: "declared", approved: "yes" }, "a declaration is shown as DECLARED, never as verified");
  ok(/shared credential, so this is a declaration, not a verified person/.test(approvedStages[2].detail), "the declaration says it is not a verified person");
  const bare = review.videoEvidenceStages({ ...base, status: "approved" }, [{ ...evs[0], reason: null }]);
  eq([bare[2].state, bare[3].state], ["not_recorded", "not_recorded"], "an approval with no declaration does not imply human review");
  const hidden = review.videoEvidenceStages({ ...base, status: "approved" }, null);
  ok(/cannot read the audit history/.test(hidden[2].detail) && hidden[2].state === "not_recorded", "without audit access, an approval's declaration is simply not visible");
  eq(review.videoEvidenceStages({ ...base, status: "attached", attachedVideoId: "abcdef1234567890" }, [])[4].state, "yes", "attached counts as approved");
  eq(review.videoEvidenceStages({ ...base, status: "rejected" }, [])[4].detail, "Rejected.", "rejected leads say so");

  // map readiness: honest about the separate map-location review
  const m1 = review.mapReadiness({ lat: 40.73, lng: -73.99, market: "nyc", published: null, locationStatuses: null });
  eq([m1.coordinates.state, m1.market.state, m1.location.state, m1.canAppear], ["valid", "valid", "not_published", false], "unpublished: coordinates fine, but no map location exists");
  ok(m1.notes.some((n) => /does not create a map point/.test(n)), "states that publishing does not create a map point");
  eq(review.mapReadiness({ lat: 0, lng: 0, market: "nyc", published: null, locationStatuses: null }).coordinates.state, "invalid", "0,0 is invalid");
  eq(review.mapReadiness({ lat: null, lng: null, market: "nyc", published: null, locationStatuses: null }).coordinates.state, "missing", "no coordinates is missing");
  eq(review.mapReadiness({ lat: 1, lng: 1, market: "mars", published: null, locationStatuses: null }).market.state, "invalid", "unknown market is invalid");
  const pub = { slug: "semma", status: "published" };
  eq(review.mapReadiness({ lat: 40.73, lng: -73.99, market: "nyc", published: pub, locationStatuses: [] }).location.state, "none", "published, no proposed location");
  eq(review.mapReadiness({ lat: 40.73, lng: -73.99, market: "nyc", published: pub, locationStatuses: ["pending"] }).canAppear, false, "a pending location does not put it on the map");
  eq(review.mapReadiness({ lat: 40.73, lng: -73.99, market: "nyc", published: pub, locationStatuses: ["approved"] }).canAppear, true, "published + valid + approved location can appear");
  eq(review.mapReadiness({ lat: 40.73, lng: -73.99, market: "nyc", published: { slug: "semma", status: "hidden" }, locationStatuses: ["approved"] }).canAppear, false, "a hidden restaurant cannot appear");
}

/* ====================== 2. real route on PostgreSQL ====================== */
const candidatesDb = sb.load("lib/db/candidates.ts");
const videoCandidatesDb = sb.load("lib/db/videoCandidates.ts");
const reviewRoute = sb.load("app/api/admin/restaurants/candidates/[id]/review/route.ts");
const candidateRoute = sb.load("app/api/admin/restaurants/candidates/[id]/route.ts");
const candidatesRoute = sb.load("app/api/admin/restaurants/candidates/route.ts");
const promoteRoute = sb.load("app/api/admin/restaurants/candidates/[id]/promote/route.ts");
const videoCandidateRoute = sb.load("app/api/admin/videos/candidates/[id]/route.ts");
const attachRoute = sb.load("app/api/admin/videos/candidates/[id]/attach/route.ts");

const call = async (handler, url, { method = "GET", secret, body, id } = {}) => {
  const headers = { ...(secret ? { "x-foodswipe-admin-secret": secret } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) };
  const res = await handler(new Request(`https://example.test${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id }) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};
const ctx = (scope, requestId) => ({ actor: { identity: scope === "publish" ? "ops-admin" : "ingest-agent", scope, assurance: "shared-credential" }, requestId, reason: null });
const NYC = { lat: 40.7306, lng: -73.9866 };
const draft = (over) => ({ market: "nyc", priceLevel: 3, ...NYC, cuisineTags: ["indian"], vibeTags: ["date night"], ...over });

// Phase 16 shaped data: three Asian-restaurant drafts, eight TikTok leads linked only by slug (as in production)
const semma = await candidatesDb.insertCandidateRestaurant(draft({ name: "Semma", slug: "semma", address: "60 Greenwich Ave, New York, NY 10011", googlePlaceId: "ChIJsemma0123456789abcdef", websiteDomain: "semma.nyc" }), ctx("draft", "req-seed-0001"));
const thai = await candidatesDb.insertCandidateRestaurant(draft({ name: "Thai Diner", slug: "thai-diner", address: "186 Mott St, New York, NY 10012", googlePlaceId: "ChIJthaidiner0123456789ab", cuisineTags: ["thai"] }), ctx("draft", "req-seed-0002"));
const dhamaka = await candidatesDb.insertCandidateRestaurant(draft({ name: "Dhamaka", slug: "dhamaka", address: "119 Delancey St, New York, NY 10002", googlePlaceId: "ChIJdhamaka0123456789abcd", priceLevel: null }), ctx("draft", "req-seed-0003"));
let tiktok = 7000000000000000000n;
const legacyLead = async (slug, n) => {
  tiktok += 1n;
  const url = `https://www.tiktok.com/@creator${n}/video/${tiktok}`;
  await client.query(
    `insert into video_candidates (id, status, platform, source_url, normalized_source_url, platform_video_id, restaurant_slug, creator_handle, creator_name, attribution_text, embed_url, legal_display_status, resolver_status, match_confidence, match_reasons, discovered_at)
     values ($1,'needs_review','tiktok',$2,$2,$3,$4,$5,$6,$7,$8,'embeddable','resolved',70,$9,now())`,
    [`lead-${slug}-${n}`, url, String(tiktok), slug, `@creator${n}`, `Creator ${n}`, `TikTok post by @creator${n}`, `https://www.tiktok.com/player/v1/${tiktok}`, ["caption mentions the restaurant"]]);
  return `lead-${slug}-${n}`;
};
const semmaLeads = [await legacyLead("semma", 1), await legacyLead("semma", 2), await legacyLead("semma", 3)];
const thaiLeads = [await legacyLead("thai-diner", 4), await legacyLead("thai-diner", 5), await legacyLead("thai-diner", 6)];
const dhamakaLeads = [await legacyLead("dhamaka", 7), await legacyLead("dhamaka", 8)];
// one lead linked by stable id (the way new leads are created)
const idLead = await videoCandidatesDb.createVideoCandidate({
  platform: "tiktok", sourceUrl: "https://www.tiktok.com/@idlinked/video/7100000000000000001", normalizedSourceUrl: "https://www.tiktok.com/@idlinked/video/7100000000000000001",
  platformVideoId: "7100000000000000001", candidateRestaurantId: semma.id, proposedRestaurantName: "Semma", creatorHandle: "@idlinked", creatorName: "ID Linked",
  attributionText: "TikTok post by @idlinked", embedUrl: "https://www.tiktok.com/player/v1/7100000000000000001", legalDisplayStatus: "embeddable", resolverStatus: "resolved",
}, ctx("draft", "req-seed-0010"));

const snapshot = async () => JSON.stringify([
  (await client.query("select * from candidate_restaurants order by id")).rows,
  (await client.query("select * from video_candidates order by id")).rows,
  (await client.query("select * from restaurants order by id")).rows,
  (await client.query("select * from restaurant_videos order by id")).rows,
  (await client.query("select * from admin_events order by seq")).rows,
  (await client.query("select * from restaurant_hero_media_selections order by id")).rows,
]);
const REVIEW = (id) => `/api/admin/restaurants/candidates/${id}/review`;

// authorization of the read
eq((await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id })).status, 401, "review: no credential -> 401");
eq((await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: "wrong-secret-value-000000" })).status, 401, "review: wrong credential -> 401");
eq((await call(reviewRoute.GET, REVIEW("nope"), { id: "nope", secret: PUBLISH })).status, 404, "review: unknown candidate -> 404");
ok("GET" in reviewRoute && !("POST" in reviewRoute) && !("PATCH" in reviewRoute) && !("PUT" in reviewRoute) && !("DELETE" in reviewRoute), "the review route exports GET only");

// read-only: opening a review changes nothing, for either credential
const before = await snapshot();
const asDraft = await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: DRAFT });
const asPublish = await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH });
eq([asDraft.status, asPublish.status], [200, 200], "review: both credentials may read");
eq(await snapshot(), before, "READ-ONLY: opening a review changes no row and writes no audit event");
for (const secret of [PUBLISH, DRAFT, "x-foodswipe-admin-secret", "DATABASE_URL"]) ok(!asDraft.text.includes(secret) && !asPublish.text.includes(secret), `review response never contains ${secret.slice(0, 12)}…`);

const p = asPublish.json;
eq(p.candidate.id, semma.id, "payload names the candidate");
eq(p.videos.length, 4, "every lead tied to Semma is returned (3 slug-linked + 1 id-linked), unpublished included");
eq(p.videos.map((v) => v.linkedBy).sort(), ["id", "slug", "slug", "slug"], "leads say how they are linked");
const slugLead = p.videos.find((v) => v.id === semmaLeads[0]);
eq([slugLead.association.kind, slugLead.association.proposedCandidate?.id], ["legacy-slug", semma.id], "a slug-only lead proposes this draft as the id to link to");
ok(slugLead.canEmbed && slugLead.verticalEmbed && /player\/v1/.test(slugLead.embedUrl), "TikTok leads expose an official, allow-listed embed (not created until a person loads it)");
eq(slugLead.stages.length, 5, "each lead carries its five evidence stages");
ok(p.videos.every((v) => v.sourceUrl.startsWith("https://www.tiktok.com/") && v.legalDisplayStatus === "embeddable"), "source URL and legal classification are present for every lead");
ok(!p.videos.some((v) => [thaiLeads, dhamakaLeads].flat().includes(v.id)), "another restaurant's leads never leak into this review");
eq((await call(reviewRoute.GET, REVIEW(thai.id), { id: thai.id, secret: PUBLISH })).json.videos.map((v) => v.id).sort(), [...thaiLeads].sort(), "Thai Diner: its 3 leads");
eq((await call(reviewRoute.GET, REVIEW(dhamaka.id), { id: dhamaka.id, secret: PUBLISH })).json.videos.map((v) => v.id).sort(), [...dhamakaLeads].sort(), "Dhamaka: its 2 leads");

// checklist reflects the real backend rules
const find = (payload, item) => payload.checklist.items.find((i) => i.id === item);
eq(find(p, "approval").state, "human", "an unapproved restaurant is waiting for a person");
eq(p.checklist.promotable, false, "not promotable until approved");
const dh = (await call(reviewRoute.GET, REVIEW(dhamaka.id), { id: dhamaka.id, secret: PUBLISH })).json;
eq([find(dh, "price").state, find(dh, "price").blocking], ["missing", true], "Dhamaka has no price: missing and blocking (as promotion enforces)");
ok(/price level/.test(dh.checklist.summary), "the summary names what is missing");
eq(find(p, "videos_by_slug").state, "human", "slug-only leads are flagged for a person");
eq(find(p, "hero").state, "missing", "no hero approved yet, and that is optional");
eq(find(p, "hero").blocking, false, "hero is not a promotion blocker");

// draft credential: no audit history, no declarations
eq([asDraft.json.audit.visible, asDraft.json.audit.events], [false, []], "draft credential receives NO audit history");
ok(!/video_candidate\.created/.test(asDraft.text) && !/ingest-agent/.test(asDraft.text), "…and none of its content leaks into the payload");
eq(asDraft.json.adminScope, "draft", "scope is reported");

// approve one lead through the real route with a reviewer declaration, then re-read
const declaration = review.buildDeclarationReason({ watchedVideo: true, restaurantIdentified: true, note: "Counter and signage match" });
const approveLead = await call(videoCandidateRoute.PATCH, `/api/admin/videos/candidates/${idLead.candidate.id}`, { method: "PATCH", secret: PUBLISH, id: idLead.candidate.id, body: { status: "approved", auditReason: declaration } });
eq(approveLead.status, 200, "publish credential approves a lead with a declaration");
const draftApprove = await call(videoCandidateRoute.PATCH, `/api/admin/videos/candidates/${semmaLeads[0]}`, { method: "PATCH", secret: DRAFT, id: semmaLeads[0], body: { status: "approved", auditReason: declaration } });
eq([draftApprove.status, draftApprove.json.code], [403, "insufficient_scope"], "draft credential cannot approve a video");
const after = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json;
const approvedLead = after.videos.find((v) => v.id === idLead.candidate.id);
eq(Object.fromEntries(approvedLead.stages.map((s) => [s.id, s.state])), { url_discovered: "yes", metadata_verified: "yes", restaurant_identified: "declared", content_reviewed: "declared", approved: "yes" }, "publish view: the declaration is shown, as a declaration");
eq([approvedLead.declaration.credential, approvedLead.declaration.note], ["ops-admin", "Counter and signage match"], "the declaration names the credential, not a person");
ok(after.audit.visible && after.audit.events.some((e) => e.action === "video_candidate.approved" && e.reason === declaration), "recent audit history includes the approval with its declaration");
ok(after.audit.events.some((e) => e.action === "restaurant_candidate.created"), "…and the draft's own creation event");
const afterDraft = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: DRAFT })).json;
const draftView = afterDraft.videos.find((v) => v.id === idLead.candidate.id);
eq([draftView.stages[2].state, draftView.stages[3].state, draftView.declaration], ["not_recorded", "not_recorded", null], "draft view of the same approval: declaration not visible, not claimed");
ok(/cannot read the audit history/.test(draftView.stages[2].detail), "…and it says why");
eq(find(after, "videos").state, "human", "unreviewed leads remain 'needs a person'");

// A lead linked by SLUG ONLY (no restaurant id on its events) must still show its own approval and declaration
const slugApprove = await call(videoCandidateRoute.PATCH, `/api/admin/videos/candidates/${semmaLeads[1]}`, { method: "PATCH", secret: PUBLISH, id: semmaLeads[1], body: { status: "approved", auditReason: review.buildDeclarationReason({ watchedVideo: true, restaurantIdentified: false, note: "Caption only" }) } });
eq(slugApprove.status, 200, "approve a slug-only lead");
const slugView = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json.videos.find((v) => v.id === semmaLeads[1]);
eq([slugView.stages[2].state, slugView.stages[3].state, slugView.declaration?.note], ["not_recorded", "declared", "Caption only"], "slug-only lead: the approval's declaration is found (watched yes, restaurant NOT declared identified)");
const slugAudit = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json.audit.events;
ok(slugAudit.some((e) => e.action === "video_candidate.approved" && e.resourceId === semmaLeads[1]), "the audit panel includes events of slug-linked leads");
ok(slugAudit.every((e, i, a) => i === 0 || a[i - 1].seq > e.seq), "audit events are newest first and not duplicated");
await call(videoCandidateRoute.PATCH, `/api/admin/videos/candidates/${semmaLeads[1]}`, { method: "PATCH", secret: PUBLISH, id: semmaLeads[1], body: { status: "needs_review" } });

// approve the restaurant, then promote: explicit, separate steps
eq((await call(candidateRoute.PATCH, `/api/admin/restaurants/candidates/${semma.id}`, { method: "PATCH", secret: DRAFT, id: semma.id, body: { status: "approved" } })).status, 403, "draft credential cannot approve the restaurant");
eq((await call(promoteRoute.POST, `/x`, { method: "POST", secret: DRAFT, id: semma.id })).status, 403, "draft credential cannot promote");
const beforeApprove = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json;
eq(beforeApprove.promoted, null, "nothing has been promoted by reading, approving a video or approving nothing");
eq((await call(candidateRoute.PATCH, `/api/admin/restaurants/candidates/${semma.id}`, { method: "PATCH", secret: PUBLISH, id: semma.id, body: { status: "approved" } })).status, 200, "publish credential approves the restaurant");
const approvedPayload = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json;
eq([approvedPayload.promoted, find(approvedPayload, "approval").state], [null, "complete"], "approving does not publish");
eq(approvedPayload.checklist.promotable, true, "approved with all required fields: promotable");
eq((await client.query("select count(*)::int n from restaurants")).rows[0].n, 0, "no live restaurant exists yet");
eq((await call(promoteRoute.POST, `/x`, { method: "POST", secret: PUBLISH, id: semma.id })).status, 201, "an explicit promote publishes");
const publishedPayload = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json;
eq(publishedPayload.promoted.slug, "semma", "published as /semma");
eq([publishedPayload.checklist.blockers, publishedPayload.checklist.items.some((i) => i.id === "conflict"), publishedPayload.checklist.summary], [0, false, "Published as /semma."], "a published restaurant shows no blockers and no false 'already published' problem");
eq(publishedPayload.mapReadiness.location.state, "none", "published with no proposed map location");
eq(publishedPayload.mapReadiness.canAppear, false, "publishing alone does NOT put a restaurant on the map");
const restaurantId = publishedPayload.promoted.id;
await client.query(`insert into restaurant_locations (restaurant_id, overture_id, release, feature_version, lat, lng, evidence, status) values ($1, 'ov-1', '2026-10', 1, 40.73, -73.99, '{"sources":[{"dataset":"meta"}]}', 'pending')`, [restaurantId]);
eq((await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json.mapReadiness.location.state, "pending", "a proposed location is pending until the map-location review approves it");
await client.query(`update restaurant_locations set status='approved', reviewed_at=now(), reviewed_by='map-review', display_name='Semma', identity_evidence_url='https://example.test/semma' where restaurant_id=$1`, [restaurantId]);
const mapped = (await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json;
eq([mapped.mapReadiness.location.state, mapped.mapReadiness.canAppear], ["approved", true], "only an approved, independently reviewed location lets it appear");
// attach is a third, separate step, available once the restaurant is published
const attachLead = await call(attachRoute.POST, `/x`, { method: "POST", secret: PUBLISH, id: idLead.candidate.id, body: { expectedRestaurantSlug: "semma" } });
eq(attachLead.status, 201, "an approved lead attaches to the published restaurant by explicit request");
eq((await call(reviewRoute.GET, REVIEW(semma.id), { id: semma.id, secret: PUBLISH })).json.videos.find((v) => v.id === idLead.candidate.id).status, "attached", "the review shows it live");

// duplicate warnings use the real publication rules
const dup = await candidatesDb.insertCandidateRestaurant(draft({ name: "Semma", slug: "semma-2", address: "60 Greenwich Avenue, New York, NY 10011", googlePlaceId: "ChIJsemmadup01234567890" }), ctx("draft", "req-seed-0020"));
const dupPayload = (await call(reviewRoute.GET, REVIEW(dup.id), { id: dup.id, secret: DRAFT })).json;
ok(dupPayload.publicationChecks.some((c) => c.code === "possible_duplicate"), "a likely duplicate is reported by the real publication checks");
ok(dupPayload.checklist.items.some((i) => i.id === "check_possible_duplicate" && i.state === "human"), "…and the checklist asks a person to decide");
const noPlace = await candidatesDb.insertCandidateRestaurant(draft({ name: "No Place Cafe", slug: "no-place-cafe", address: "5 Elsewhere St, New York, NY 10001", googlePlaceId: null }), ctx("draft", "req-seed-0021"));
eq(find((await call(reviewRoute.GET, REVIEW(noPlace.id), { id: noPlace.id, secret: PUBLISH })).json, "place_id").state, "human", "a missing Place ID needs a person's decision (and a written override), it is not a hard block");
// a lead that has no link at all (not returned) and a rejected lead (returned)
await call(videoCandidateRoute.PATCH, `/api/admin/videos/candidates/${thaiLeads[0]}`, { method: "PATCH", secret: PUBLISH, id: thaiLeads[0], body: { status: "rejected" } });
eq((await call(reviewRoute.GET, REVIEW(thai.id), { id: thai.id, secret: PUBLISH })).json.videos.find((v) => v.id === thaiLeads[0]).status, "rejected", "rejected leads stay visible with their status");
// links: leads point at the review page of their restaurant (by id, or the single proposed draft for a slug-only lead)
const videosListRoute = sb.load("app/api/admin/videos/candidates/route.ts");
const leadList = (await call(videosListRoute.GET, "/api/admin/videos/candidates?status=needs_review", { secret: DRAFT })).json.candidates;
const slugOnlyLead = leadList.find((c) => c.id === dhamakaLeads[0]);
eq(slugOnlyLead.restaurantReviewUrl, `https://example.test/admin/restaurants/candidates/${dhamaka.id}`, "a slug-only lead links to the review page of the one draft its slug identifies");
eq(slugOnlyLead.adminUrl, `https://example.test/admin/videos/candidates?candidate=${dhamakaLeads[0]}`, "the video queue link is preserved");
eq((await call(candidatesRoute.GET, "/api/admin/restaurants/candidates", { secret: DRAFT })).json.candidates.find((c) => c.id === dhamaka.id).adminUrl, `https://example.test/admin/restaurants/candidates/${dhamaka.id}`, "the candidate list's adminUrl is the review page");
// no Google, no resolver: the review route never touches them
const routeSource = readFileSync(join(root, "app/api/admin/restaurants/candidates/[id]/review/route.ts"), "utf8");
ok(!/lib\/places|socialVideo|lib\/youtube|fetch\(/.test(routeSource.replace(/\/\*[\s\S]*?\*\//, "")), "the review route imports no Google, resolver or network code");
ok(!/\.(insert|update|delete)\(|auditedInsert|auditedUpdate/.test(routeSource), "the review route performs no writes");

/* ====================== 3. static guards on the screens ====================== */
const src = (f) => readFileSync(join(root, f), "utf8");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const panels = ["IdentityPanel", "DetailsPanel", "PhotographyPanel", "VideoReviewPanel", "MapReadinessPanel", "AuditPanel", "ReadinessRail"].map((n) => [n, strip(src(`components/admin-review/${n}.tsx`))]);
const container = strip(src("components/AdminRestaurantReview.tsx"));
const photo = Object.fromEntries(panels).PhotographyPanel;
const video = Object.fromEntries(panels).VideoReviewPanel;
const rail = Object.fromEntries(panels).ReadinessRail;

ok(!/useEffect/.test(photo) && !/fetch\(/.test(photo), "Photography: no effect and no request of its own, so nothing billable can run on load");
ok(/\{browse && hasPlace && \(/.test(photo) && /\{preview && \(/.test(photo), "Photography: Google photo candidates and the hero preview mount only after a button press");
for (const [name, text] of panels) ok(!/useEffect/.test(text), `${name}: has no effect, so nothing can run by itself`);
ok(!/method:\s*"(PATCH|POST|PUT|DELETE)"/.test(container) && /cache: "no-store"/.test(container) && (container.match(/fetch\(/g) ?? []).length === 1, "the page container performs exactly one request, and it is a read");
ok(!/useEffect/.test(container), "the page container has no effect: nothing loads until the Open review button is pressed");
const everything = [container, ...panels.map(([, t]) => t), strip(src("app/admin/restaurants/candidates/[id]/page.tsx"))].join("\n");
ok(!/sessionStorage|localStorage|indexedDB|document\.cookie|history\.(push|replace)State/.test(everything), "the admin secret is never written to browser storage, a cookie or the URL");
ok(/useState\(""\)/.test(container) && !/Keep it for this browser tab/.test(container), "the secret lives in component memory only; there is no keep-it opt-in");
ok((video.match(/<iframe/g) ?? []).length === 1 && /playerOpen && video\.canEmbed && video\.embedUrl/.test(video), "Videos: a single iframe, created only for the open player and only for an allow-listed embed");
ok(/useState<string \| null>\(null\)/.test(video) && /activePlayer === video\.id/.test(video), "Videos: one active player at a time");
ok(!/autoplay|autoPlay/i.test(video), "Videos: nothing autoplays");
ok(/data-testid="view-original"/.test(video) && /target="_blank" rel="noopener noreferrer"/.test(video), "Videos: View original stays visible and opens safely");
for (const [file, text] of [["videos", video], ["rail", rail]]) {
  ok(/publishOnly/.test(text) && /DRAFT_HINT/.test(text), `${file}: publish-only actions are gated for the draft credential and say why`);
}
ok(/setPending\("approve"\)/.test(video) && /run\(pending\)/.test(video) && !/run\("approve"\)/.test(video), "Videos: approve is a button, then a confirmation, never a direct call");
ok(/setPending\("promote"\)/.test(rail) && /\{pending === "promote" && \(/.test(rail), "Rail: promote needs its own confirmation step");
ok(/override: \{ acknowledge: warningCodes, reason: overrideReason\.trim\(\) \}/.test(rail) && /MIN_OVERRIDE_REASON_LENGTH/.test(rail), "Rail: warnings need a written override of at least the server's minimum length");
ok(/disabled=\{busy \|\| !overrideOk\}/.test(rail), "Rail: the publish button stays disabled until the override is complete");
ok(/const overrideOk = pending !== "promote" \|\| !needsOverride/.test(rail), "Rail: the override gate applies to publishing only, so a restaurant with warnings can still be approved");
ok(/useReducer\(reasonReducer/.test(video) && /useReducer\(reasonReducer/.test(rail), "reasons are bound to one action (the stale-reason fix applies here too)");
ok(/data-testid="open-full-review"/.test(src("components/AdminCandidates.tsx")) && /\/admin\/restaurants\/candidates\/\$\{candidate\.id\}/.test(src("components/AdminCandidates.tsx")), "the candidate list links each restaurant to its full review page");
ok(/\/admin\/restaurants\/candidates\/\$\{association\.candidate\.id\}/.test(src("components/AdminVideoCandidates.tsx")), "the video queue links a lead's restaurant to its review page");
ok(/params: Promise<\{ id: string \}>/.test(src("app/admin/restaurants/candidates/[id]/page.tsx")) && /await params/.test(src("app/admin/restaurants/candidates/[id]/page.tsx")), "the page awaits its params (Next 16)");
ok(!/dangerouslySetInnerHTML/.test(panels.map(([, t]) => t).join("")), "no raw HTML injection from stored data");

console.log(`admin-review-check: ${checks} checks passed.`);
await client.close();
