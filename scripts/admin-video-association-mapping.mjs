// READ-ONLY by default. Maps legacy slug-linked video candidates to restaurant-candidate ids so a human can
// review the mapping BEFORE any production association changes.
//
//   FOODSWIPE_ADMIN_DRAFT_SECRET=... node scripts/admin-video-association-mapping.mjs [--base https://host] [--out mapping.json]
//   (the draft credential is enough: reading needs no publication authority; FOODSWIPE_ADMIN_SECRET also works)
//
// Writing is a SEPARATE explicit step and only after the new API is deployed:
//   node scripts/admin-video-association-mapping.mjs --apply reviewed-mapping.json
// It sends PATCH { candidateRestaurantId } only for rows a person set to "approved": true, and verifies that the
// response echoes the new id (the pre-hardening API ignores that field and would answer 200 without changing anything).
// The secret is read from the environment and never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { buildMapping } from "./lib/video-association-mapping.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = (opt("--base", process.env.ADMIN_BASE_URL ?? "https://food-swipe-red.vercel.app")).replace(/\/$/, "");
const secret = process.env.FOODSWIPE_ADMIN_DRAFT_SECRET || process.env.FOODSWIPE_ADMIN_SECRET;
if (!secret) { console.error("Set FOODSWIPE_ADMIN_DRAFT_SECRET (or FOODSWIPE_ADMIN_SECRET) in the environment."); process.exit(2); }
const headers = { "x-foodswipe-admin-secret": secret, "content-type": "application/json" };
async function api(path, init = {}) {
  const res = await fetch(base + path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${body.code ?? body.error ?? ""}`);
  return body;
}

const applyFile = opt("--apply", null);
if (!applyFile) {
  const [{ candidates: restaurants }, { candidates: videos }] = await Promise.all([api("/api/admin/restaurants/candidates"), api("/api/admin/videos/candidates")]);
  const rows = buildMapping(restaurants, videos);
  const out = opt("--out", "video-association-mapping.json");
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), base, reviewRequired: true, note: "Set approved:true on each row you accept, then run with --apply.", rows }, null, 2));
  console.log(`${rows.length} video candidates; wrote ${out} (nothing was changed).`);
  for (const r of rows) console.log(`${r.action.padEnd(20)} ${r.videoCandidateId}  ${String(r.currentRestaurantSlug ?? "-").padEnd(14)} -> ${r.proposedCandidateRestaurantId ?? "-"} ${r.proposedCandidateName ? `(${r.proposedCandidateName}, ${r.proposedCandidateMarket}, ${r.proposedCandidateStatus})` : ""} ${r.notes.join("; ")}`);
} else {
  const { rows } = JSON.parse(readFileSync(applyFile, "utf8"));
  let done = 0;
  for (const r of rows.filter((x) => x.approved === true && x.action === "link-by-id")) {
    const res = await api(`/api/admin/videos/candidates/${r.videoCandidateId}`, { method: "PATCH", body: JSON.stringify({ candidateRestaurantId: r.proposedCandidateRestaurantId }) });
    if (res.candidate?.candidateRestaurantId !== r.proposedCandidateRestaurantId) throw new Error(`${r.videoCandidateId}: the server did not apply the link (is the hardened API deployed?). Stopping.`);
    done++;
    console.log(`linked ${r.videoCandidateId} -> ${r.proposedCandidateRestaurantId}`);
  }
  console.log(`${done} associations changed; ${rows.length - done} rows left untouched.`);
}
