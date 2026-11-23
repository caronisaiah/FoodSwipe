// QA only: serves the REAL admin route handlers over HTTP on an isolated in-memory PostgreSQL (PGlite), seeded
// with three restaurant drafts and eight slug-linked TikTok leads shaped like the Phase 16 records, so the real
// review workspace can be exercised in a browser. No production access, no network, no persistence.
//
//   QA_PUBLISH_SECRET=... QA_DRAFT_SECRET=... node docs/qa/admin-hardening-c/qa-server.mjs
//   (optional) QA_FIXTURE=/path/to/fixture.json to seed from a local, uncommitted copy of real records.
//
// The browser app calls /api/admin/*; run `next dev` for the pages and redirect those calls to this server
// (the QA notes show how). Credentials are throw-away values you supply (>= 16 chars, different).
import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const { createTestDatabase, createAppSandbox } = await import(`${repo}/scripts/lib/pg-harness.mjs`);
const PUBLISH = process.env.QA_PUBLISH_SECRET, DRAFT = process.env.QA_DRAFT_SECRET;
if (!PUBLISH || !DRAFT || PUBLISH === DRAFT || PUBLISH.length < 16 || DRAFT.length < 16) throw new Error("Set QA_PUBLISH_SECRET and QA_DRAFT_SECRET (distinct, >= 16 chars).");
const PORT = Number(process.env.QA_PORT ?? 4011);

const { client, db } = await createTestDatabase();
const sb = createAppSandbox(db, { env: { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT, FOODSWIPE_ADMIN_PUBLISH_LABEL: "ops-admin", FOODSWIPE_ADMIN_DRAFT_LABEL: "ingest-agent" } });
const mod = (p) => sb.load(p);

/* ---- seed data ---- */
const synthetic = {
  drafts: [
    { id: "qa-draft-a", slug: "demo-south-indian", name: "Demo South Indian", market: "nyc", address: "60 Demo Ave, New York, NY 10011", google_place_id: "ChIJdemoSouthIndian0123456789", website_domain: "example.com", lat: 40.7360, lng: -74.0005, price_level: 4, cuisine_tags: ["indian"], review_notes: "Trial draft. Not yet done by a human: vibe tags, reason text, hero photo.", suggestion_confidence: "medium" },
    { id: "qa-draft-b", slug: "demo-thai-diner", name: "Demo Thai Diner", market: "nyc", address: "186 Demo St, New York, NY 10012", google_place_id: "ChIJdemoThaiDiner012345678901", website_domain: "example.org", lat: 40.7207, lng: -73.9957, price_level: 2, cuisine_tags: ["diner", "american"], review_notes: null, suggestion_confidence: "medium" },
    { id: "qa-draft-c", slug: "demo-indian-market", name: "Demo Indian Market Stall", market: "nyc", address: "119 Demo Delancey St, New York, NY 10002", google_place_id: null, website_domain: null, lat: 40.7182, lng: -73.988, price_level: null, cuisine_tags: ["indian"], review_notes: null, suggestion_confidence: null },
  ],
  leads: [
    ["demo-south-indian", "@demo.creator.one", "TikTok post by demo.creator.one", "Restaurant name visible in a sampled frame. Audio and sponsorship not assessed."],
    ["demo-south-indian", "@demo.creator.two", "TikTok post by demo.creator.two", "Caption names the restaurant; not confirmed inside the video."],
    ["demo-south-indian", "@demo.creator.three", "TikTok post by demo.creator.three", null],
    ["demo-thai-diner", "@demo.creator.four", "TikTok post by demo.creator.four", "Brand account: policy call needed."],
    ["demo-thai-diner", "@demo.creator.five", "TikTok post by demo.creator.five", null],
    ["demo-thai-diner", "@demo.creator.six", "TikTok post by demo.creator.six", null],
    ["demo-indian-market", "@demo.creator.seven", "TikTok post by demo.creator.seven", null],
    ["demo-indian-market", "@demo.creator.eight", "TikTok post by demo.creator.eight", null],
  ].map(([restaurant_slug, creator_handle, attribution_text, review_notes], i) => {
    const vid = `70000000000000000${String(i + 10)}`;
    return { id: `qa-lead-${i + 1}`, restaurant_slug, source_url: `https://www.tiktok.com/${creator_handle}/video/${vid}`, platform_video_id: vid, creator_handle, attribution_text, embed_url: `https://www.tiktok.com/player/v1/${vid}`, review_notes, discovered_at: new Date().toISOString() };
  }),
};
const seed = process.env.QA_FIXTURE ? JSON.parse(readFileSync(process.env.QA_FIXTURE, "utf8")) : synthetic;
for (const d of seed.drafts) {
  await client.query(
    `insert into candidate_restaurants (id, slug, name, status, market, source, google_place_id, website_domain, address, lat, lng, price_level, cuisine_tags, review_notes, suggestion_confidence, source_expires_at)
     values ($1,$2,$3,'needs_review',$4,'google_places',$5,$6,$7,$8,$9,$10,$11::text[],$12,$13,now() + interval '30 days')`,
    [d.id, d.slug, d.name, d.market ?? "nyc", d.google_place_id, d.website_domain, d.address, d.lat, d.lng, d.price_level, d.cuisine_tags ?? [], d.review_notes, d.suggestion_confidence]);
}
for (const l of seed.leads) {
  await client.query(
    `insert into video_candidates (id, status, platform, source_url, normalized_source_url, platform_video_id, restaurant_slug, proposed_restaurant_name, creator_handle, attribution_text, embed_url, legal_display_status, resolver_status, review_notes, discovered_at)
     values ($1,'needs_review','tiktok',$2,$2,$3,$4,$5,$6,$7,$8,'embeddable','resolved',$9,$10)`,
    [l.id, l.source_url, l.platform_video_id, l.restaurant_slug, seed.drafts.find((d) => d.slug === l.restaurant_slug)?.name ?? null, l.creator_handle, l.attribution_text, l.embed_url, l.review_notes, l.discovered_at]);
}
console.log("seeded", seed.drafts.map((d) => `${d.slug}=${d.id}`).join(" "), `| ${seed.leads.length} slug-linked leads (needs_review, unattached)`);

/* ---- routing: every admin route handler, discovered from the app directory ---- */
const files = [];
const walk = (dir) => { for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name === "route.ts") files.push(p); } };
walk("app/api/admin");
const routes = files.map((file) => {
  const parts = file.replace("app/api/admin/", "").replace("/route.ts", "").split("/");
  const names = [];
  const re = new RegExp("^/api/admin/" + parts.map((p) => { const m = /^\[(\w+)\]$/.exec(p); if (m) { names.push(m[1]); return "([^/]+)"; } return p.replace(/[.*+?^${}()|\\]/g, "\\$&"); }).join("/") + "$");
  return { file, re, names, specificity: parts.filter((p) => !p.startsWith("[")).length };
}).sort((a, b) => b.specificity - a.specificity);

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-foodswipe-admin-secret, content-type", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS" };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const hit = routes.map((r) => [r, r.re.exec(url.pathname)]).find(([, m]) => m);
    if (!hit) { res.writeHead(404, cors); return res.end(JSON.stringify({ error: "no such QA route" })); }
    const [route, match] = hit;
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const handler = mod(route.file)[req.method];
    if (!handler) { res.writeHead(405, cors); return res.end(); }
    const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
    const response = await handler(request, { params: Promise.resolve(params) });
    res.writeHead(response.status, { ...cors, "content-type": response.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, cors); res.end(JSON.stringify({ error: "qa server error", detail: String(e?.message ?? e).slice(0, 200) }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`qa api on ${PORT}`));
