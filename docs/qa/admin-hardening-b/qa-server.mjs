// QA-only: serves the REAL admin route handlers over HTTP on an isolated in-memory PostgreSQL (PGlite) so the
// real admin screens can be exercised in a browser. Synthetic credentials and data; no production access.
import http from "node:http";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const { createTestDatabase, createAppSandbox } = await import(`${repo}/scripts/lib/pg-harness.mjs`);
// Throw-away credentials for this local QA server only. Supply them (>= 16 chars, different from each other):
//   QA_PUBLISH_SECRET=... QA_DRAFT_SECRET=... node docs/qa/admin-hardening-b/qa-server.mjs
const PUBLISH = process.env.QA_PUBLISH_SECRET, DRAFT = process.env.QA_DRAFT_SECRET;
if (!PUBLISH || !DRAFT || PUBLISH === DRAFT || PUBLISH.length < 16 || DRAFT.length < 16) throw new Error("Set QA_PUBLISH_SECRET and QA_DRAFT_SECRET (distinct, >= 16 chars).");
const { db } = await createTestDatabase();
const sb = createAppSandbox(db, { env: { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT, FOODSWIPE_ADMIN_PUBLISH_LABEL: "ops-admin", FOODSWIPE_ADMIN_DRAFT_LABEL: "ingest-agent" } });
const mod = (p) => sb.load(p);
const cand = mod("lib/db/candidates.ts"), rest = mod("lib/db/restaurants.ts"), vcs = mod("lib/db/videoCandidates.ts"), vids = mod("lib/db/videos.ts");
const ctx = (scope, r) => ({ actor: { identity: scope === "publish" ? "ops-admin" : "ingest-agent", scope, assurance: "shared-credential" }, requestId: r });
const NYC = { lat: 40.7306, lng: -73.9866 };
const mk = (o) => ({ market: "nyc", priceLevel: 2, ...NYC, cuisineTags: ["indian"], vibeTags: ["casual"], ...o });

// seed a realistic history through the real, audited code paths
const dosa = await cand.insertCandidateRestaurant(mk({ name: "Demo Dosa House", slug: "demo-dosa-house", address: "10 Demo St, New York, NY 10011", googlePlaceId: "ChIJdemodosa0123456789abc" }), ctx("draft", "seed-req-0001"));
await cand.updateCandidateRestaurant(dosa.id, { reasonText: "Crisp dosas and a calm room." }, ctx("draft", "seed-req-0002"));
await cand.updateCandidateRestaurant(dosa.id, { status: "approved" }, ctx("publish", "seed-req-0003"));
const promoted = await rest.promoteCandidateToRestaurant(dosa.id, ctx("publish", "seed-req-0004"));
const vc = await vcs.createVideoCandidate({ platform: "tiktok", sourceUrl: "https://www.tiktok.com/@demo.eats/video/1111111111111111111", normalizedSourceUrl: "https://www.tiktok.com/@demo.eats/video/1111111111111111111", platformVideoId: "1111111111111111111", candidateRestaurantId: dosa.id, creatorHandle: "@demo.eats", creatorName: "demo.eats", caption: "Best dosa in the village", embedUrl: "https://www.tiktok.com/player/v1/1111111111111111111", attributionText: "TikTok post by demo.eats", legalDisplayStatus: "embeddable", resolverStatus: "resolved" }, ctx("draft", "seed-req-0005"));
await vcs.patchVideoCandidate(vc.candidate.id, { status: "approved" }, ctx("publish", "seed-req-0006"));
const att = await vcs.attachVideoCandidate(vc.candidate.id, promoted.restaurant.slug, ctx("publish", "seed-req-0007"));
await vids.updatePublishedVideo(att.videoId, { creatorHandle: "@demo.eats.nyc", attributionText: "TikTok post by @demo.eats.nyc" }, { ...ctx("publish", "seed-req-0008"), reason: "Creator changed their handle" });
const vc2 = await vcs.createVideoCandidate({ platform: "youtube", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", normalizedSourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", platformVideoId: "abcdefghijk", candidateRestaurantId: dosa.id, creatorHandle: "@noodlenotes", caption: "A short review", attributionText: "YouTube post by noodlenotes", legalDisplayStatus: "embeddable", resolverStatus: "resolved" }, ctx("draft", "seed-req-0009"));
await vcs.patchVideoCandidate(vc2.candidate.id, { status: "approved" }, ctx("publish", "seed-req-0010"));
const att2 = await vcs.attachVideoCandidate(vc2.candidate.id, promoted.restaurant.slug, ctx("publish", "seed-req-0011"));
await vids.hideVideo(att2.videoId, { ...ctx("publish", "seed-req-0012"), reason: "Wrong restaurant" });
// a candidate that will need an override to publish: no Place ID
const noodle = await cand.insertCandidateRestaurant(mk({ name: "Demo Noodle Bar", slug: "demo-noodle-bar", address: "77 Demo Ave, New York, NY 10003", googlePlaceId: null }), ctx("draft", "seed-req-0013"));
await cand.updateCandidateRestaurant(noodle.id, { status: "approved" }, ctx("publish", "seed-req-0014"));
console.log("seeded", JSON.stringify({ dosa: dosa.id, noodle: noodle.id, video: att.videoId, hidden: att2.videoId }));

const routes = [
  [/^\/api\/admin\/audit\/events$/, "app/api/admin/audit/events/route.ts", () => ({})],
  [/^\/api\/admin\/videos$/, "app/api/admin/videos/route.ts", () => ({})],
  [/^\/api\/admin\/videos\/([^/]+)\/restore$/, "app/api/admin/videos/[id]/restore/route.ts", (m) => ({ id: m[1] })],
  [/^\/api\/admin\/videos\/([^/]+)$/, "app/api/admin/videos/[id]/route.ts", (m) => ({ id: m[1] })],
  [/^\/api\/admin\/restaurants\/candidates$/, "app/api/admin/restaurants/candidates/route.ts", () => ({})],
  [/^\/api\/admin\/restaurants\/candidates\/([^/]+)\/promote$/, "app/api/admin/restaurants/candidates/[id]/promote/route.ts", (m) => ({ id: m[1] })],
  [/^\/api\/admin\/restaurants\/candidates\/([^/]+)$/, "app/api/admin/restaurants/candidates/[id]/route.ts", (m) => ({ id: m[1] })],
];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-foodswipe-admin-secret, content-type", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4010");
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const hit = routes.map(([re, file, p]) => [re.exec(url.pathname), file, p]).find(([m]) => m);
  if (!hit) { res.writeHead(404, cors); return res.end(JSON.stringify({ error: "no such QA route" })); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const handler = mod(hit[1])[req.method];
  if (!handler) { res.writeHead(405, cors); return res.end(); }
  const response = await handler(request, { params: Promise.resolve(hit[2](hit[0])) });
  res.writeHead(response.status, { ...cors, "content-type": response.headers.get("content-type") ?? "application/json" });
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(4010, "127.0.0.1", () => console.log("qa api on 4010"));
