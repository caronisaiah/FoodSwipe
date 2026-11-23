// Behaviour checks for the hardened admin API: validation, market, duplicates, associations,
// scope-restricted edits, direct-attach, taxonomy. Real route + library code in a sandbox with
// in-memory fakes for the database and the video resolver. No network, database or browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox } from "./lib/ts-sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = "synthetic-publish-secret-0123456789";
const DRAFT = "synthetic-draft-secret-abcdefghij";
let checks = 0;
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => { assert.deepEqual(norm(a), norm(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ------------------------------------------------------------------ fakes
function world() {
  const w = {
    candidates: new Map(), published: new Map(), videoCandidates: new Map(), liveVideos: [], calls: [], seq: 0,
    sources: [], resolverBase: { platform: "tiktok", platformVideoId: null, creatorHandle: null, creatorName: null, caption: null, thumbnailUrl: null, embedUrl: null, attributionText: "TikTok post", publishedAt: null, sourceFetchedAt: null, legalDisplayStatus: "embeddable", resolverStatus: "resolved", resolverError: null },
  };
  const id = (p) => `${p}-${++w.seq}`;
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  w.addCandidate = (c) => { const row = { id: id("cand"), slug: slugify(c.name), status: "needs_review", market: "nyc", googlePlaceId: null, address: null, lat: null, lng: null, priceLevel: null, cuisineTags: [], dietaryTags: [], vibeTags: [], bestFor: [], dishHighlights: [], reasonText: null, reviewNotes: null, websiteDomain: null, neighborhood: null, source: "manual", ...c }; w.candidates.set(row.id, row); return row; };
  w.addPublished = (r) => { const row = { id: id("pub"), status: "published", market: "nyc", googlePlaceId: null, address: null, sourceCandidateId: null, ...r }; w.published.set(row.id, row); return row; };
  const rec = (kind, r) => ({ kind, id: r.id, name: r.name, address: r.address ?? null, market: r.market, status: r.status, slug: r.slug ?? null, googlePlaceId: r.googlePlaceId ?? null });
  const candidatesDb = {
    CANDIDATE_STATUSES: ["candidate", "approved", "rejected", "needs_review"],
    slugify,
    getCandidateRestaurant: async (i) => { const c = w.candidates.get(i); return c ? JSON.parse(JSON.stringify(c)) : null; }, // a copy, like a real read
    getExistingCandidateSlugs: async () => new Set([...w.candidates.values()].map((c) => c.slug)),
    insertCandidateRestaurant: async (input) => {
      if (input.googlePlaceId && [...w.candidates.values()].some((c) => c.googlePlaceId === input.googlePlaceId)) throw new Error("unique violation");
      if (!["nyc", "dc"].includes(input.market)) throw new Error("market required");
      const row = w.addCandidate({ ...input, cuisineTags: input.cuisineTags ?? [], dietaryTags: input.dietaryTags ?? [], vibeTags: input.vibeTags ?? [], bestFor: input.bestFor ?? [], dishHighlights: input.dishHighlights ?? [] });
      w.calls.push("insertCandidate");
      return row;
    },
    updateCandidateRestaurant: async (i, write) => { const c = w.candidates.get(i); if (!c) return null; Object.assign(c, write); w.calls.push("updateCandidate"); return JSON.parse(JSON.stringify(c)); },
    addRestaurantSource: async (...a) => { w.sources.push(a); },
    listCandidateRestaurants: async () => [...w.candidates.values()],
  };
  const identity = {
    listIdentityRecords: async () => [...[...w.candidates.values()].map((c) => rec("candidate", c)), ...[...w.published.values()].map((p) => rec("published", p))],
    findPlaceIdConflict: async (pid, exclude) => {
      const c = [...w.candidates.values()].find((x) => x.googlePlaceId === pid && x.id !== exclude);
      if (c) return rec("candidate", c);
      const p = [...w.published.values()].find((x) => x.googlePlaceId === pid);
      return p ? rec("published", p) : null;
    },
    getPromotedRestaurantForCandidate: async (cid) => { const p = [...w.published.values()].find((x) => x.sourceCandidateId === cid); return p ? { id: p.id, slug: p.slug, status: p.status, market: p.market } : null; },
    getCandidateRef: async (i) => { const c = w.candidates.get(i); return c ? { id: c.id, name: c.name, slug: c.slug, market: c.market, status: c.status } : null; },
    getPublishedRefBySlug: async (s) => { const p = [...w.published.values()].find((x) => x.slug === s); return p ? { id: p.id, slug: p.slug, name: p.name, market: p.market, status: p.status, sourceCandidateId: p.sourceCandidateId } : null; },
    getPublishedRefBySourceCandidate: async (cid) => { const p = [...w.published.values()].find((x) => x.sourceCandidateId === cid); return p ? { id: p.id, slug: p.slug, name: p.name, market: p.market, status: p.status, sourceCandidateId: p.sourceCandidateId } : null; },
    searchRestaurantTargets: async () => [],
  };
  const videoDb = {
    createVideoCandidate: async (input) => {
      const dup = [...w.videoCandidates.values()].find((v) => v.normalizedSourceUrl === input.normalizedSourceUrl);
      if (dup) return { candidate: dup, duplicate: true };
      const row = { id: id("vc"), status: "needs_review", attachedVideoId: null, createdAt: "t", updatedAt: "t", discoveredAt: "t", matchReasons: [], ...input };
      w.videoCandidates.set(row.id, row); w.calls.push("createVideoCandidate");
      return { candidate: row, duplicate: false };
    },
    getVideoCandidate: async (i) => { const v = w.videoCandidates.get(i); return v ? JSON.parse(JSON.stringify(v)) : null; },
    patchVideoCandidate: async (i, patch) => { const v = w.videoCandidates.get(i); if (!v) return { ok: false, code: "not-found" }; if (v.status === "attached") return { ok: false, code: "attached" }; Object.assign(v, patch); w.calls.push("patchVideoCandidate:" + JSON.stringify(Object.keys(patch))); return { ok: true, candidate: JSON.parse(JSON.stringify(v)) }; },
    listVideoCandidates: async () => [...w.videoCandidates.values()],
    getAssociationSummaries: async (list) => Object.fromEntries(list.map((v) => [v.id, { kind: v.candidateRestaurantId ? "candidate" : v.restaurantSlug ? "published" : "none", problems: [] }])),
    getCandidateVideoMetaMap: async () => ({}),
    attachVideoCandidate: async (i, slug) => { const v = w.videoCandidates.get(i); w.calls.push("attach:" + slug); if (!v || v.status !== "approved") return { ok: false, code: "not-approved", status: v?.status }; v.status = "attached"; v.attachedVideoId = "vc-" + i; w.liveVideos.push({ id: "vc-" + i, restaurantId: slug }); return { ok: true, videoId: "vc-" + i, candidate: v, alreadyAttached: false, restaurantSlug: slug }; },
  };
  const social = { resolveSocialVideo: async (url) => /tiktok\.com\/@[^/]+\/video\/\d+/.test(url) ? { ok: true, resolved: { ...w.resolverBase, sourceUrl: url, normalizedSourceUrl: url.toLowerCase() } } : { ok: false, error: "Unsupported URL" } };
  const videos = { getActiveVideos: async (rid) => w.liveVideos.filter((v) => v.restaurantId === rid), insertVideo: async (rid, v) => { w.liveVideos.push({ ...v, restaurantId: rid }); w.calls.push("insertVideo"); return v; } };
  const restaurantsDb = {
    getAppRestaurantById: async (s) => { const p = [...w.published.values()].find((x) => x.slug === s); if (p) return { id: p.slug, name: p.name }; return w.seedIds?.includes(s) ? { id: s, name: s } : null; },
    getCandidatePromotionConflictMap: async () => ({}),
  };
  const sb = createSandbox({
    root, env: { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT },
    overrides: {
      "lib/db/index.ts": { isDbConfigured: () => true, getDb: () => null },
      "lib/db/candidates.ts": candidatesDb, "lib/db/identity.ts": identity, "lib/db/videoCandidates.ts": videoDb,
      "lib/db/videos.ts": videos, "lib/db/restaurants.ts": restaurantsDb,
      "lib/db/restaurantEvidence.ts": { getCandidateEvidenceMetaMap: async () => ({}) },
      "lib/db/heroMediaSelections.ts": { getApprovedHeroSelectionMapForCandidates: async () => ({}) },
      "lib/socialVideo.ts": social,
    },
  });
  w.sb = sb;
  w.videoDb = videoDb;
  w.route = (p) => sb.load(`app/api/admin/${p}/route.ts`);
  return w;
}
const ORIGIN = "https://admin.example.test";
async function send(route, method, body, { secret = DRAFT, id = "id-1", slug = "slug-1", raw } = {}) {
  const init = { method, headers: { "content-type": "application/json", "x-foodswipe-admin-secret": secret } };
  if (method !== "GET") init.body = raw ?? JSON.stringify(body ?? {});
  const res = await route[method](new Request(`${ORIGIN}/api/admin/x`, init), { params: Promise.resolve({ id, slug }) });
  return { status: res.status, body: await res.json() };
}
const codes = (r) => (r.body.errors ?? []).map((e) => `${e.field}:${e.code}`);
const GOOD = { name: "Semma", market: "nyc" };

// ------------------------------------------------------------------ A. candidate create
{
  const w = world(); const route = w.route("restaurants/candidates");
  for (const secret of [DRAFT, PUBLISH]) {
    let r = await send(route, "POST", { name: "No Market" }, { secret });
    eq([r.status, r.body.code, codes(r)], [422, "validation_failed", ["market:market_required"]], "missing market is rejected, never defaulted to DC");
    r = await send(route, "POST", { name: "X", market: "" }, { secret });
    eq(codes(r), ["market:market_required"]);
    r = await send(route, "POST", { name: "X", market: "mars" }, { secret });
    eq(codes(r), ["market:invalid_market"]);
    r = await send(route, "POST", { name: "X", market: 5 }, { secret });
    eq(codes(r), ["market:invalid_market"]);
  }
  eq(w.candidates.size, 0, "no record was created by any rejected request");

  let r = await send(route, "POST", { name: "Semma", market: " NYC ", cuisineTags: ["indian", "thai", "chinese", "vietnamese", "dim sum"], priceLevel: 4, lat: 40.7359, lng: -74.0012, googlePlaceId: "PLACE-1", address: "60 Greenwich Ave, New York, NY 10011, USA" });
  eq(r.status, 201); eq(r.body.candidate.market, "nyc", "market normalized to lowercase");
  ok(r.body.id && r.body.id === r.body.candidate.id, "returns the persisted record id");
  ok(r.body.adminUrl === `${ORIGIN}/admin/restaurants/candidates/${r.body.id}`, "returns the direct review-page URL on the request origin");
  eq(r.body.candidate.status, "needs_review", "drafts start in needs_review");
  eq(r.body.candidate.cuisineTags, ["indian", "thai", "chinese", "vietnamese", "dim sum"], "the new Asian cuisines are accepted");
  const first = r.body.candidate;

  r = await send(route, "POST", { name: "Semma Clone", market: "nyc", googlePlaceId: "PLACE-1" });
  eq([r.status, r.body.code, r.body.existing.id], [409, "place_id_conflict", first.id], "duplicate Google Place ID -> clear 409 naming the existing record");
  eq(w.candidates.size, 1, "the conflict created nothing");
  w.addPublished({ name: "Pub", slug: "pub", googlePlaceId: "PLACE-PUB", address: "1 Main St", market: "nyc" });
  r = await send(route, "POST", { name: "Pub Two", market: "nyc", googlePlaceId: "PLACE-PUB" });
  eq([r.status, r.body.code, r.body.existing.kind], [409, "place_id_conflict", "published"], "a Place ID owned by a published restaurant also conflicts");

  const bad = [
    [{ ...GOOD, foo: 1 }, "foo:unknown_field"], [{ ...GOOD, source: "google_places" }, "source:unknown_field"], [{ ...GOOD, id: "x" }, "id:unknown_field"],
    [{ ...GOOD, status: "approved" }, "status:invalid_status"], [{ ...GOOD, status: "published" }, "status:invalid_status"],
    [{ ...GOOD, priceLevel: 5 }, "priceLevel:invalid_price"], [{ ...GOOD, priceLevel: 2.5 }, "priceLevel:invalid_price"], [{ ...GOOD, priceLevel: "2" }, "priceLevel:invalid_price"], [{ ...GOOD, priceLevel: 0 }, "priceLevel:invalid_price"],
    [{ ...GOOD, cuisineTags: ["klingon"] }, "cuisineTags:unknown_tag"], [{ ...GOOD, cuisineTags: "thai" }, "cuisineTags:invalid_type"], [{ ...GOOD, vibeTags: ["spooky"] }, "vibeTags:unknown_tag"], [{ ...GOOD, dietaryTags: ["paleo"] }, "dietaryTags:unknown_tag"], [{ ...GOOD, bestFor: ["x"] }, "bestFor:unknown_tag"],
    [{ ...GOOD, lat: 91, lng: 0.5 }, "lat:coordinate_out_of_range"], [{ ...GOOD, lat: 10, lng: 181 }, "lng:coordinate_out_of_range"], [{ ...GOOD, lat: 0, lng: 0 }, "lat:null_island"],
    [{ ...GOOD, lat: "40", lng: "-74" }, "lat:invalid_coordinate"], [{ ...GOOD, lat: 40.7 }, "lng:incomplete_coordinates"], [{ ...GOOD, lat: null, lng: null }, "lng:incomplete_coordinates"],
    [{ ...GOOD, websiteDomain: "https://semma.nyc/menu" }, "websiteDomain:invalid_domain"], [{ ...GOOD, slug: "Bad Slug" }, "slug:invalid_slug"],
    [{ ...GOOD, name: "" }, "name:empty_value"], [{ market: "nyc" }, "name:required"], [{ ...GOOD, notes: "a", reviewNotes: "b" }, "notes:conflicting_fields"],
  ];
  for (const [payload, expected] of bad) {
    const res = await send(route, "POST", payload);
    eq([res.status, res.body.code, codes(res).includes(expected)], [422, "validation_failed", true], `rejects ${JSON.stringify(payload)} with ${expected} (got ${codes(res)})`);
  }
  const countAfterBad = w.candidates.size;
  r = await send(route, "POST", null, { raw: "{not json" });
  eq([r.status, r.body.code], [400, "invalid_json"]);
  r = await send(route, "POST", [1, 2]); eq(codes(r), ["body:invalid_body"]);
  eq(w.candidates.size, countAfterBad, "invalid requests never write");

  // Conservative duplicate hints: warnings never block, branches are not merged.
  w.addCandidate({ name: "Nom Wah Tea Parlor", slug: "nom-wah-doyers", address: "13 Doyers St, New York, NY 10013, USA", googlePlaceId: "NW1" });
  w.addPublished({ name: "Essex Market Stall", slug: "essex-stall", address: "119 Delancey Street, Store #3, New York, NY 10002", market: "nyc" });
  r = await send(route, "POST", { name: "Nom Wah Tea Parlor", market: "nyc", address: "13 Doyers Street, New York, NY 10013", googlePlaceId: "NW2" });
  eq(r.status, 201, "a likely duplicate by address is still created (warning only)");
  ok(r.body.warnings.some((x) => x.code === "possible_duplicate_address" && x.severity === "warning"), "same address + same name -> warning");
  r = await send(route, "POST", { name: "Nom Wah Tea Parlor", market: "nyc", address: "15 Mott St, New York, NY 10013", googlePlaceId: "NW3" });
  eq(r.status, 201); ok(r.body.warnings.some((x) => x.code === "same_name_other_location" && x.severity === "info") && !r.body.warnings.some((x) => x.severity === "warning"), "same name at another address is an INFO about a branch, never a merge warning");
  r = await send(route, "POST", { name: "Dhamaka", market: "nyc", address: "119 Delancey St, New York, NY 10002", googlePlaceId: "DH1" });
  ok(r.body.warnings.some((x) => x.code === "same_address_different_name" && x.severity === "info") && !r.body.warnings.some((x) => x.severity === "warning"), "a different restaurant in the same building is only informational");
  r = await send(route, "POST", { name: "Nom Wah Tea Parlor", market: "dc", address: "13 Doyers St", googlePlaceId: "NW4" });
  ok(!r.body.warnings.some((x) => x.existing), "other markets are never compared");
  r = await send(route, "POST", { name: "Far Away", market: "nyc", lat: 38.9, lng: -77.03 });
  ok(r.body.warnings.some((x) => x.code === "coordinates_far_from_market"), "coordinates ~200 miles from the market centre produce a warning");
}

// ------------------------------------------------------------------ B. candidate patch
{
  const w = world(); const route = w.route("restaurants/candidates/[id]");
  const c = w.addCandidate({ name: "Thai Diner", market: "nyc", googlePlaceId: "TD1", lat: 40.72, lng: -73.99, address: "186 Mott St, New York, NY 10012" });
  const before = JSON.stringify(c);
  const bad = [
    [{ foo: 1 }, "foo:unknown_field"], [{ status: "published" }, "status:invalid_status"], [{ status: "bogus" }, "status:invalid_status"], [{ market: "mars" }, "market:invalid_market"], [{ market: null }, "market:market_required"],
    [{ priceLevel: 9 }, "priceLevel:invalid_price"], [{ cuisineTags: ["klingon"] }, "cuisineTags:unknown_tag"], [{ lat: 123, lng: 5 }, "lat:coordinate_out_of_range"], [{ lat: 40 }, "lng:incomplete_coordinates"],
    [{}, "body:empty_patch"], [{ source: "manual" }, "source:unknown_field"], [{ sourceFetchedAt: "2020-01-01" }, "sourceFetchedAt:unknown_field"],
  ];
  for (const secret of [DRAFT, PUBLISH]) {
    for (const [payload, expected] of bad) {
      const r = await send(route, "PATCH", payload, { id: c.id, secret });
      eq([r.status, codes(r).includes(expected)], [422, true], `PATCH ${JSON.stringify(payload)} -> ${expected} (got ${r.status} ${codes(r)})`);
    }
  }
  eq(JSON.stringify(c), before, "no invalid PATCH changed the record (the old behaviour returned 200 and ignored them)");
  let r = await send(route, "PATCH", [], { id: c.id }); eq(codes(r), ["body:invalid_body"]);
  r = await send(route, "PATCH", { name: "x" }, { id: "missing" }); eq([r.status, r.body.code], [404, "not_found"]);

  // the exact body the existing admin UI sends keeps working
  r = await send(route, "PATCH", { status: "needs_review", priceLevel: null, cuisineTags: ["thai", "diner"], dietaryTags: [], vibeTags: ["casual"], bestFor: [], dishHighlights: ["Pad thai"], reasonText: "", reviewNotes: "checked" }, { id: c.id });
  eq(r.status, 200, "existing UI payload accepted"); eq(r.body.candidate.cuisineTags, ["thai", "diner"], "response carries the persisted values");
  eq(r.body.changedFields.sort(), ["cuisineTags", "dishHighlights", "reviewNotes", "vibeTags"].sort());
  ok(r.body.adminUrl.endsWith(`/admin/restaurants/candidates/${c.id}`) && r.body.id === c.id);
  // market correction before publication
  r = await send(route, "PATCH", { market: "dc" }, { id: c.id });
  eq([r.status, r.body.candidate.market, r.body.changedFields], [200, "dc", ["market"]], "a candidate's market can be corrected before publication");
  ok(r.body.warnings.some((x) => x.code === "coordinates_far_from_market"), "…and the now-mismatched coordinates are flagged");
  await send(route, "PATCH", { market: "nyc" }, { id: c.id });
  w.addPublished({ name: "Thai Diner", slug: "thai-diner", sourceCandidateId: c.id });
  r = await send(route, "PATCH", { market: "dc" }, { id: c.id });
  eq([r.status, r.body.code], [409, "already_promoted"], "the market cannot change after publication");
  eq(c.market, "nyc");
  // Place ID conflicts
  const other = w.addCandidate({ name: "Other", market: "nyc", googlePlaceId: "OT1" });
  r = await send(route, "PATCH", { googlePlaceId: "OT1" }, { id: c.id }); eq([r.status, r.body.code], [409, "place_id_conflict"]);
  r = await send(route, "PATCH", { googlePlaceId: "TD1" }, { id: c.id }); eq(r.status, 200, "re-sending its own Place ID is fine");
  void other;
  // scope rules
  const draftTarget = w.addCandidate({ name: "Draft Target", market: "nyc" });
  r = await send(route, "PATCH", { status: "approved" }, { id: draftTarget.id, secret: DRAFT });
  eq([r.status, r.body.code, r.body.requiredScope], [403, "insufficient_scope", "publish"], "a draft credential cannot approve");
  r = await send(route, "PATCH", { status: "rejected" }, { id: draftTarget.id, secret: DRAFT }); eq(r.status, 403, "…nor reject");
  r = await send(route, "PATCH", { status: "candidate" }, { id: draftTarget.id, secret: DRAFT }); eq(r.status, 200, "…but may move a draft between candidate and needs_review");
  r = await send(route, "PATCH", { status: "approved" }, { id: draftTarget.id, secret: PUBLISH }); eq([r.status, r.body.candidate.status], [200, "approved"], "the publication credential approves");
  r = await send(route, "PATCH", { reviewNotes: "agent edit after approval" }, { id: draftTarget.id, secret: DRAFT });
  eq([r.status, r.body.code], [403, "draft_cannot_edit_approved"], "a draft credential cannot edit a candidate after a human approved it");
  r = await send(route, "PATCH", { reviewNotes: "human edit" }, { id: draftTarget.id, secret: PUBLISH }); eq(r.status, 200);
}

// ------------------------------------------------------------------ C. video candidates: association by stable id
{
  const w = world(); const route = w.route("videos/candidates"); const patchRoute = w.route("videos/candidates/[id]");
  const nyc = w.addCandidate({ name: "Semma", slug: "semma", market: "nyc" });
  const dc = w.addCandidate({ name: "DC Place", slug: "dc-place", market: "dc" });
  const URL1 = "https://www.tiktok.com/@jyu.eats/video/7203179655342476590";
  let r = await send(route, "POST", { sourceUrl: URL1, candidateRestaurantId: nyc.id, creatorHandle: "@jyu.eats", creatorName: "jyu.eats", attributionText: "TikTok post by jyu.eats (@jyu.eats)" });
  eq(r.status, 201);
  eq([r.body.candidate.candidateRestaurantId, r.body.candidate.restaurantSlug, r.body.candidate.status], [nyc.id, null, "needs_review"], "linked by stable id; the typed slug is not stored; always needs_review");
  eq([r.body.candidate.creatorHandle, r.body.candidate.creatorName], ["@jyu.eats", "jyu.eats"], "creator display name can be saved");
  ok(r.body.adminUrl.includes("/admin/videos/candidates?candidate=") && r.body.id);
  eq(r.body.restaurantReviewUrl, `${ORIGIN}/admin/restaurants/candidates/${nyc.id}`, "a lead linked by id points at its restaurant's review page");
  eq(r.body.warnings, []);
  const vc1 = r.body.candidate;

  r = await send(route, "POST", { sourceUrl: URL1, candidateRestaurantId: nyc.id }); eq([r.status, r.body.code, r.body.existing.id], [409, "duplicate_video", vc1.id], "retrying the same URL is a clean 409");
  eq(w.videoCandidates.size, 1);
  const cases = [
    [{ sourceUrl: URL1.replace("7203", "7204"), candidateRestaurantId: "nope" }, "candidateRestaurantId:unknown_candidate"],
    [{ sourceUrl: URL1.replace("7203", "7205"), restaurantSlug: "semma" }, "restaurantSlug:unknown_restaurant"], // a draft's slug is NOT a published restaurant
    [{ sourceUrl: URL1.replace("7203", "7206"), restaurantSlug: "typo-slug" }, "restaurantSlug:unknown_restaurant"],
    [{ sourceUrl: URL1.replace("7203", "7207"), candidateRestaurantId: nyc.id, foo: 1 }, "foo:unknown_field"],
    [{ sourceUrl: URL1.replace("7203", "7208"), candidateRestaurantId: 5 }, "candidateRestaurantId:invalid_type"],
    [{ sourceUrl: URL1.replace("7203", "7209"), creatorHandle: "jyu.eats" }, "creatorHandle:invalid_handle"],
    [{ sourceUrl: "https://example.com/x" }, null],
    [{}, "sourceUrl:required"],
  ];
  for (const [payload, expected] of cases) {
    const res = await send(route, "POST", payload);
    ok([422].includes(res.status), `${JSON.stringify(payload)} -> 422 (got ${res.status})`);
    if (expected) ok(codes(res).includes(expected), `${expected} (got ${codes(res)})`); else eq(res.body.code, "unsupported_url");
  }
  eq(w.videoCandidates.size, 1, "no rejected intake created a record");

  // published restaurants: slug is canonicalized to the candidate id; cross-market and mismatches are errors
  const pubNyc = w.addPublished({ name: "Semma", slug: "semma-2", sourceCandidateId: nyc.id, market: "nyc" });
  const pubDc = w.addPublished({ name: "Other", slug: "other-dc", sourceCandidateId: dc.id, market: "dc" });
  const legacy = w.addPublished({ name: "Legacy", slug: "legacy", sourceCandidateId: null, market: "nyc" });
  const hidden = w.addPublished({ name: "Hidden", slug: "hidden", status: "hidden", market: "nyc" });
  const U = (n) => `https://www.tiktok.com/@a/video/${7300000000000000000n + BigInt(n)}`;
  r = await send(route, "POST", { sourceUrl: U(1), restaurantSlug: "semma-2" });
  eq([r.status, r.body.candidate.candidateRestaurantId, r.body.candidate.restaurantSlug], [201, nyc.id, "semma-2"], "a published slug resolves to the stable candidate id");
  r = await send(route, "POST", { sourceUrl: U(2), restaurantSlug: "legacy" }); eq([r.status, r.body.candidate.candidateRestaurantId, r.body.candidate.restaurantSlug], [201, null, "legacy"], "a published restaurant with no candidate of origin is linked by its (validated) slug");
  r = await send(route, "POST", { sourceUrl: U(3), restaurantSlug: "hidden" }); eq(codes(r), ["restaurantSlug:restaurant_not_published"]);
  r = await send(route, "POST", { sourceUrl: U(4), candidateRestaurantId: nyc.id, restaurantSlug: "other-dc" }); eq(codes(r), ["restaurantSlug:cross_market_association"], "candidate in one market + restaurant in another -> cross-market error");
  r = await send(route, "POST", { sourceUrl: U(5), candidateRestaurantId: nyc.id, restaurantSlug: "legacy" }); eq(codes(r), ["restaurantSlug:association_mismatch"], "two references to different restaurants are rejected");
  r = await send(route, "POST", { sourceUrl: U(6), candidateRestaurantId: nyc.id, restaurantSlug: "semma-2" }); eq(r.status, 201, "two references to the SAME restaurant are accepted");
  void pubNyc; void pubDc; void legacy; void hidden;
  r = await send(route, "POST", { sourceUrl: U(7), proposedRestaurantName: "Somewhere" }); eq([r.status, r.body.warnings[0]?.code], [201, "no_restaurant_linked"], "an unlinked lead is allowed but flagged");

  // PATCH rules
  r = await send(patchRoute, "PATCH", { sourceUrl: "https://x.test" }, { id: vc1.id }); eq([r.status, codes(r)], [422, ["sourceUrl:unknown_field"]], "immutable source identity cannot be edited");
  r = await send(patchRoute, "PATCH", { creatorHandle: "nohandle" }, { id: vc1.id }); eq(codes(r), ["creatorHandle:invalid_handle"]);
  r = await send(patchRoute, "PATCH", { matchConfidence: 150 }, { id: vc1.id }); eq(codes(r), ["matchConfidence:invalid_confidence"]);
  r = await send(patchRoute, "PATCH", { status: "attached" }, { id: vc1.id }); eq(codes(r), ["status:invalid_status"], "attached can only be set by the attach action");
  r = await send(patchRoute, "PATCH", { status: "approved" }, { id: vc1.id, secret: DRAFT }); eq([r.status, r.body.code], [403, "insufficient_scope"], "a draft credential cannot approve a video");
  r = await send(patchRoute, "PATCH", { status: "rejected" }, { id: vc1.id, secret: DRAFT }); eq(r.status, 403);
  r = await send(patchRoute, "PATCH", { creatorName: "Jyu" }, { id: vc1.id, secret: DRAFT }); eq([r.status, r.body.candidate.creatorName], [200, "Jyu"], "a draft credential can edit creator details of a lead");
  r = await send(patchRoute, "PATCH", { restaurantSlug: "other-dc" }, { id: vc1.id, secret: DRAFT });
  eq([r.status, r.body.candidate.candidateRestaurantId, r.body.candidate.restaurantSlug], [200, dc.id, "other-dc"], "re-linking replaces the whole association");
  r = await send(patchRoute, "PATCH", { candidateRestaurantId: nyc.id }, { id: vc1.id, secret: DRAFT });
  eq([r.status, r.body.candidate.candidateRestaurantId, r.body.candidate.restaurantSlug], [200, nyc.id, null], "…and the omitted reference is cleared, so a stale slug cannot linger");
  r = await send(patchRoute, "PATCH", { candidateRestaurantId: nyc.id, restaurantSlug: "other-dc" }, { id: vc1.id, secret: DRAFT }); eq(codes(r), ["restaurantSlug:cross_market_association"]);
  r = await send(patchRoute, "PATCH", { status: "approved" }, { id: vc1.id, secret: PUBLISH }); eq([r.status, r.body.candidate.status], [200, "approved"]);
  r = await send(patchRoute, "PATCH", { reviewNotes: "x" }, { id: vc1.id, secret: DRAFT }); eq([r.status, r.body.code], [403, "draft_cannot_edit_reviewed"], "a draft credential cannot edit a reviewed video lead");
  w.videoCandidates.get(vc1.id).status = "attached"; w.videoCandidates.get(vc1.id).attachedVideoId = "v";
  r = await send(patchRoute, "PATCH", { reviewNotes: "x" }, { id: vc1.id, secret: PUBLISH }); eq([r.status, r.body.code], [409, "attached_locked"]);
}

// ------------------------------------------------------------------ D. direct attach cannot bypass review
{
  const w = world(); const route = w.route("restaurants/[slug]/videos");
  const cand = w.addCandidate({ name: "Semma", slug: "semma", market: "nyc" });
  w.addPublished({ name: "Semma", slug: "semma", sourceCandidateId: cand.id });
  w.seedIds = ["seed-place"];
  const URL1 = "https://www.tiktok.com/@a/video/7300000000000000001";
  let r = await send(route, "POST", { sourceUrl: URL1 }, { slug: "semma", secret: DRAFT });
  eq([r.status, r.body.code], [403, "insufficient_scope"], "a draft credential cannot add a live video directly");
  eq(w.calls.length, 0);
  r = await send(route, "POST", { sourceUrl: URL1, restaurantSlug: "semma" }, { slug: "semma", secret: PUBLISH }); eq(codes(r), ["restaurantSlug:unknown_field"]);
  r = await send(route, "POST", { sourceUrl: URL1 }, { slug: "semma", secret: PUBLISH });
  eq(r.status, 201, "the human administrator can still add a video from the profile editor");
  eq(w.calls.filter((c) => !c.startsWith("patch")), ["createVideoCandidate", "attach:semma"], "…through the candidate lifecycle: create, approve, then attach");
  ok(w.calls.some((c) => c.startsWith("patchVideoCandidate")), "approval step ran");
  eq([...w.videoCandidates.values()][0].candidateRestaurantId, cand.id, "the new candidate is linked by stable id");
  r = await send(route, "POST", { sourceUrl: URL1 }, { slug: "semma", secret: PUBLISH }); eq([r.status, r.body.code], [409, "duplicate_video"], "adding the same video again is refused");
  // a video the review queue REJECTED cannot be pushed live through the shortcut
  const URL2 = "https://www.tiktok.com/@b/video/7300000000000000002";
  const rejected = (await w.videoDb.createVideoCandidate({ platform: "tiktok", sourceUrl: URL2, normalizedSourceUrl: URL2.toLowerCase() })).candidate;
  rejected.status = "rejected";
  const liveBefore = w.liveVideos.length;
  r = await send(route, "POST", { sourceUrl: URL2 }, { slug: "semma", secret: PUBLISH });
  eq([r.status, r.body.code, r.body.existing.status], [409, "duplicate_video", "rejected"], "a rejected video cannot bypass its rejection");
  eq(w.liveVideos.length, liveBefore, "nothing went live");
  r = await send(route, "POST", { sourceUrl: "https://example.com/v" }, { slug: "semma", secret: PUBLISH }); eq(r.body.code, "unsupported_url");
  r = await send(route, "POST", { sourceUrl: URL2 }, { slug: "no-such", secret: PUBLISH }); eq([r.status, r.body.code], [404, "restaurant_not_found"]);
  // seed restaurants keep the direct insert, still publication-only
  r = await send(route, "POST", { sourceUrl: "https://www.tiktok.com/@c/video/7300000000000000003" }, { slug: "seed-place", secret: PUBLISH });
  eq([r.status, w.calls.includes("insertVideo")], [201, true]);
}

// ------------------------------------------------------------------ E. pure rules
{
  const sb = createSandbox({ root });
  const assoc = sb.load("lib/videoAssociation.ts");
  const cands = { c1: { id: "c1", name: "Semma", slug: "semma", market: "nyc", status: "approved" }, c0: { id: "c0", name: "Semma (other)", slug: "semma", market: "dc", status: "approved" } };
  const pubs = [
    { id: "p0", slug: "semma", name: "Other Semma", market: "dc", status: "published", sourceCandidateId: "c0" },
    { id: "p1", slug: "semma-2", name: "Semma", market: "nyc", status: "published", sourceCandidateId: "c1" },
  ];
  const lookups = { publishedBySourceCandidate: (id) => pubs.find((p) => p.sourceCandidateId === id) ?? null, publishedBySlug: (s) => pubs.find((p) => p.slug === s) ?? null };
  // Promotion changed the slug: the video follows the restaurant, not the string.
  let t = await assoc.resolveAttachTarget({ candidateRestaurantId: "c1", restaurantSlug: null }, lookups);
  eq([t.ok, t.slug, t.restaurantId], [true, "semma-2", "p1"], "id-linked video resolves to the promoted slug 'semma-2'");
  t = await assoc.resolveAttachTarget({ candidateRestaurantId: "c1", restaurantSlug: "semma" }, lookups);
  eq([t.ok, t.code], [false, "target-mismatch"], "a stale stored slug that now belongs to a DIFFERENT restaurant is refused, never followed");
  t = await assoc.resolveAttachTarget({ candidateRestaurantId: "unpublished", restaurantSlug: null }, lookups); eq([t.ok, t.code], [false, "restaurant-not-published"]);
  t = await assoc.resolveAttachTarget({ candidateRestaurantId: null, restaurantSlug: "semma" }, lookups);
  eq([t.ok, t.restaurantId], [true, "p0"], "(documented legacy hazard) a slug-only link resolves to whoever owns the slug, which is why new links use ids");
  t = await assoc.resolveAttachTarget({ candidateRestaurantId: null, restaurantSlug: null }, lookups); eq(t.code, "target-required");
  const inputs = { candidateById: (id) => cands[id] ?? null, publishedBySlug: lookups.publishedBySlug };
  eq((await assoc.resolveAssociation({ candidateRestaurantId: "c1", restaurantSlug: "semma" }, inputs)).code, "cross_market_association", "id c1 (nyc) + slug 'semma' (dc restaurant)");
  eq((await assoc.resolveAssociation({ candidateRestaurantId: "c1", restaurantSlug: "semma-2" }, inputs)).ok, true);
  eq((await assoc.resolveAssociation({}, inputs)).kind, "none");

  const dup = sb.load("lib/duplicateWarnings.ts");
  eq(dup.normalizeStreet("119 Delancey Street, Essex Market #34, New York, NY 10002"), "119 delancey st");
  eq(dup.normalizeStreet("60 Greenwich Avenue, New York, NY 10011"), dup.normalizeStreet("60 Greenwich Ave, New York, NY 10011, USA"));
  eq(dup.normalizeStreet("Essex Market, New York"), null, "no house number -> not comparable");
  eq(dup.normalizeName("The Thai Diner!"), "thai diner");

  // readiness: out-of-range coordinates cannot be promoted
  const ready = sb.load("lib/candidateReadiness.ts");
  const base = { status: "approved", name: "X", address: "1 A St", priceLevel: 2, lat: 40.7, lng: -74, cuisineTags: ["thai"], vibeTags: ["casual"] };
  eq(ready.missingPromotionRequiredFields(base), []);
  eq(ready.missingPromotionRequiredFields({ ...base, lat: 500 }), ["lat"], "latitude 500 is not publishable");
  eq(ready.missingPromotionRequiredFields({ ...base, lng: -999 }), ["lng"]);
  eq(ready.missingPromotionRequiredFields({ ...base, lat: 0, lng: 0 }).includes("lat"), true);
  eq(ready.missingPromotionRequiredFields({ ...base, cuisineTags: ["klingon"] }), ["cuisineTags"], "unknown cuisines still block promotion (now caught at entry first)");
  eq(ready.computeCandidateReadiness({ ...base, lat: 500 }).isReadyToPromote, false);
}

// ------------------------------------------------------------------ F. taxonomy
{
  const sb = createSandbox({ root });
  const vocab = sb.load("lib/vocab.ts");
  const typeSrc = readFileSync(join(root, "lib/types.ts"), "utf8");
  const union = (name) => [...typeSrc.slice(typeSrc.indexOf(`export type ${name} =`), typeSrc.indexOf(";", typeSrc.indexOf(`export type ${name} =`))).matchAll(/\|\s*"([^"]+)"/g)].map((m) => m[1]);
  const cravings = union("Craving");
  eq([...new Set([...cravings, ...union("Cuisine")])].sort(), [...vocab.CUISINES].sort(), "types.ts Cuisine union and the runtime vocabulary list exactly the same tags");
  for (const tag of ["chinese", "thai", "vietnamese", "dim sum"]) ok(vocab.CUISINES.includes(tag) && !cravings.includes(tag), `${tag} added as a display cuisine, not an onboarding craving`);
  const previous = ["burgers","sushi","tacos","pasta","soul food","ramen","coffee","dessert","mediterranean","halal","vegan","filipino","asian","dinner","middle eastern","french","brunch","american","new american","italian","japanese","noodles","southern","diner","mexican","street food","bar food","british","omakase","cafe","bakery","vegetarian","persian","kebab","ice cream","indian","korean","ethiopian","laotian","seafood","pizza","bagels"];
  eq(previous.filter((t) => !vocab.CUISINES.includes(t)), [], "every pre-existing tag is still valid (no removals or renames)");
  eq(vocab.CUISINES.length, previous.length + 4, "exactly four tags were added");
  eq(new Set(vocab.CUISINES).size, vocab.CUISINES.length, "no duplicate tags");
  eq(vocab.filterCuisines(["thai", "burgers", "klingon", "dim sum"]), ["thai", "burgers", "dim sum"]);
  const tagger = sb.load("lib/candidateTagger.ts");
  for (const [rule, tags] of [["thai_restaurant", ["thai"]], ["chinese_restaurant", ["chinese"]], ["vietnamese_restaurant", ["vietnamese"]]]) {
    const s = tagger.suggestCandidateTags({ name: "Place", primaryType: rule, types: [rule], priceLevel: 2, query: "q" });
    eq(s.cuisineTags, tags, `Google type ${rule} -> ${tags}`);
  }
  eq(tagger.suggestCandidateTags({ name: "Thai Diner", primaryType: null, types: [], priceLevel: 2, query: "q" }).cuisineTags.sort(), ["american", "diner", "thai"], "'Thai Diner' now gets thai (it was only diner/american)");
  eq(tagger.suggestCandidateTags({ name: "Nom Wah Dim Sum", primaryType: null, types: [], priceLevel: 1, query: "q" }).cuisineTags.sort(), ["chinese", "dim sum"]);
  eq(tagger.suggestCandidateTags({ name: "Pho 79", primaryType: null, types: [], priceLevel: 1, query: "q" }).cuisineTags.sort(), ["asian", "noodles", "vietnamese"], "pho keeps its previous tags and gains vietnamese");
  eq(tagger.suggestCandidateTags({ name: "Taqueria X", primaryType: "mexican_restaurant", types: [], priceLevel: 1, query: "q" }).cuisineTags.sort(), ["mexican", "street food", "tacos"], "unrelated rules are unchanged");
  for (const [k, rule] of Object.entries(tagger.TYPE_RULES)) for (const c of rule.cuisines) ok(vocab.CUISINES.includes(c), `TYPE_RULES ${k} -> ${c} is in the vocabulary`);
  for (const rule of tagger.NAME_RULES) for (const c of rule.cuisines) ok(vocab.CUISINES.includes(c), `NAME_RULES ${rule.kw[0]} -> ${c}`);
}

console.log(`Admin API checks passed (${checks} assertions; real routes and libraries, in-memory fakes, no network or database).`);
