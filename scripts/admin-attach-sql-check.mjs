// Verifies the REAL attachVideoCandidate: target resolution by stable id (including a slug that changed at
// promotion) and the structure of the single atomic SQL statement it sends. The SQL is rendered with the
// real Drizzle PostgreSQL dialect; it is NOT executed (no database is available in this check).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox } from "./lib/ts-sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { PgDialect } = require(join(root, "node_modules/drizzle-orm/pg-core"));
let checks = 0;
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => { assert.deepEqual(norm(a), norm(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

function candidateRow(over = {}) {
  return {
    id: "vc-1", status: "approved", platform: "tiktok", sourceUrl: "https://www.tiktok.com/@jyu.eats/video/7203179655342476590",
    normalizedSourceUrl: "https://www.tiktok.com/@jyu.eats/video/7203179655342476590", platformVideoId: "7203179655342476590",
    restaurantSlug: null, candidateRestaurantId: "c1", proposedRestaurantName: "Semma", creatorHandle: "@jyu.eats", creatorName: "jyu.eats",
    caption: null, thumbnailUrl: null, embedUrl: "https://www.tiktok.com/player/v1/7203179655342476590", attributionText: "TikTok post by jyu.eats",
    publishedAt: null, discoveredAt: new Date("2026-11-22T00:00:00Z"), sourceFetchedAt: null, sourceExpiresAt: null, matchConfidence: null, matchReasons: [],
    legalDisplayStatus: "embeddable", resolverStatus: "resolved", resolverError: null, reviewNotes: null, attachedVideoId: null,
    createdAt: new Date("2026-11-22T00:00:00Z"), updatedAt: new Date("2026-11-22T00:00:00Z"), ...over,
  };
}
function harness({ row, published, claimRows = 1 }) {
  const state = { executed: [], row };
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.row ? [state.row] : []) }) }) }),
    execute: async (q) => { state.executed.push(q); return { rows: claimRows ? [{ id: "vc-vc-1" }] : [] }; },
  };
  const bySource = (id) => published.find((p) => p.sourceCandidateId === id) ?? null;
  const bySlug = (s) => published.find((p) => p.slug === s) ?? null;
  const sb = createSandbox({ root, overrides: {
    "lib/db/index.ts": { getDb: () => fakeDb, isDbConfigured: () => true },
    "lib/db/identity.ts": { getPublishedRefBySourceCandidate: async (id) => bySource(id), getPublishedRefBySlug: async (s) => bySlug(s) },
  } });
  return { state, mod: sb.load("lib/db/videoCandidates.ts") };
}
const dialect = new PgDialect();
const pubs = [
  { id: "p0", slug: "semma", name: "Another Semma", market: "dc", status: "published", sourceCandidateId: "c0" },
  { id: "p1", slug: "semma-2", name: "Semma", market: "nyc", status: "published", sourceCandidateId: "c1" },
];

// 1. A restaurant promoted under a different slug: the video follows the stable id.
{
  const h = harness({ row: candidateRow(), published: pubs });
  const wrong = await h.mod.attachVideoCandidate("vc-1", "semma");
  eq([wrong.ok, wrong.code], [false, "target-changed"], "confirming the typed slug 'semma' (another restaurant) is refused");
  eq(h.state.executed.length, 0, "…and nothing was written");
  const res = await h.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([res.ok, res.restaurantSlug, res.alreadyAttached], [true, "semma-2", false], "attaches to the restaurant that was promoted from the candidate");
  eq(h.state.executed.length, 1, "exactly one atomic statement");
  const q = dialect.sqlToQuery(h.state.executed[0]);
  const flat = q.sql.replace(/\s+/g, " ");
  ok(q.params.includes("semma-2") && q.params.includes("c1"), "the statement is parameterised with the resolved slug and the stable candidate id");
  ok(!q.params.includes("semma"), "the stale typed slug 'semma' never reaches the database");
  ok(/from "restaurants" where slug = \$\d+ and status = 'published'/.test(flat), "target must still be published at that slug");
  ok(/source_candidate_id = \$\d+::text/.test(flat), "target must still have been promoted from the linked candidate");
  ok(/for share/.test(flat), "target is locked against a concurrent hide");
  ok(/exists \(select 1 from target\)/.test(flat), "no target -> nothing is claimed");
  ok(/candidate_restaurant_id is null or candidate_restaurant_id = \(select source_candidate_id from target\)/.test(flat), "claim re-checks the candidate link inside the statement");
  ok(/status = 'approved' and attached_video_id is null/.test(flat), "only an approved, unattached candidate is claimed");
  ok(/insert into "restaurant_videos"/.test(flat) && /from claimed/.test(flat), "the video row is inserted only from the claimed candidate");
  ok(/restaurant_slug = \(select slug from target\)/.test(flat), "the resolved slug is recorded on the candidate");
}
// 2. Legacy slug-only link (the eight Phase 16C candidates) still attaches, to a published restaurant only.
{
  const legacy = candidateRow({ candidateRestaurantId: null, restaurantSlug: "semma-2" });
  const h = harness({ row: legacy, published: pubs });
  const res = await h.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([res.ok, res.restaurantSlug], [true, "semma-2"]);
  const hid = harness({ row: legacy, published: [{ ...pubs[1], status: "hidden" }] });
  const r2 = await hid.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([r2.ok, r2.code, hid.state.executed.length], [false, "restaurant-not-found", 0], "a hidden restaurant is never a target");
  const none = harness({ row: candidateRow({ candidateRestaurantId: null, restaurantSlug: "semma" }), published: [] });
  const r3 = await none.mod.attachVideoCandidate("vc-1", "semma");
  eq([r3.ok, r3.code, none.state.executed.length], [false, "restaurant-not-found", 0], "a draft's slug is not a publishable target");
}
// 3. Guards that do not depend on the target.
{
  const h = harness({ row: candidateRow({ status: "needs_review" }), published: pubs });
  eq((await h.mod.attachVideoCandidate("vc-1", "semma-2")).code, "not-approved", "unapproved candidates never attach");
  const rej = harness({ row: candidateRow({ status: "rejected" }), published: pubs });
  eq((await rej.mod.attachVideoCandidate("vc-1", "semma-2")).code, "not-approved");
  const noSlug = harness({ row: candidateRow(), published: pubs });
  eq((await noSlug.mod.attachVideoCandidate("vc-1")).code, "target-required", "the human must confirm the target slug");
  const unlinked = harness({ row: candidateRow({ candidateRestaurantId: null, restaurantSlug: null }), published: pubs });
  eq((await unlinked.mod.attachVideoCandidate("vc-1", "semma-2")).code, "target-required", "an unlinked lead has no target");
  const unpublished = harness({ row: candidateRow({ candidateRestaurantId: "c-unpublished" }), published: pubs });
  const u = await unpublished.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([u.ok, u.code, unpublished.state.executed.length], [false, "restaurant-not-found", 0], "a draft restaurant cannot receive a video until it is published");
  const mismatch = harness({ row: candidateRow({ restaurantSlug: "semma" }), published: pubs });
  eq((await mismatch.mod.attachVideoCandidate("vc-1", "semma-2")).code, "target-changed", "id and stored slug disagree -> refused");
  const attached = harness({ row: candidateRow({ status: "attached", attachedVideoId: "vc-vc-1", restaurantSlug: "semma-2" }), published: pubs });
  const again = await attached.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([again.ok, again.alreadyAttached, attached.state.executed.length], [true, true, 0], "a retry is idempotent and writes nothing");
  const raced = harness({ row: candidateRow(), published: pubs, claimRows: 0 });
  const lost = await raced.mod.attachVideoCandidate("vc-1", "semma-2");
  eq([lost.ok, lost.code], [false, "target-changed"], "if the target changed between check and write, nothing is attached");
}
console.log(`Attach resolution checks passed (${checks} assertions; real code + real Drizzle dialect rendering; SQL not executed, no database).`);
