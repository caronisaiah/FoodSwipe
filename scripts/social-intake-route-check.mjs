// Route-level regression for social intake: the four admin routes that call resolveSocialVideo, run with the REAL resolver
// (lib/socialVideo, safeFetch, youtube, video) and only the database + search provider + global fetch replaced by recording
// fakes. No network, no DNS, no database, no credentials. Proves, with NO resolver options set anywhere in the app:
//   - TikTok short links are refused with 422 unsupported_url (or a failed lead) BEFORE any request and BEFORE any insert;
//   - canonical TikTok / Instagram / YouTube links still create (201) even when provider metadata fails (mocked);
//   - discovery refuses short-link leads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox } from "./lib/ts-sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = "synthetic-publish-secret-0123456789";
const DRAFT = "synthetic-draft-secret-abcdefghij";
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m); checks++; };

const SHORTS = ["https://vm.tiktok.com/ZMabc123/", "https://vt.tiktok.com/ZSxYz9/", "https://www.tiktok.com/t/ZTabc12/"];
const VID = "7203179655342476590";
const CANON = {
  tiktok: `https://www.tiktok.com/@jyu.eats/video/${VID}`,
  instagram: "https://www.instagram.com/reel/Cabc_123-xY/",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};
const RESTAURANT = { id: "semma", name: "Semma", market: "nyc", neighborhood: "West Village", address: "60 Greenwich Ave", cuisineTags: ["indian"], dishHighlights: [], websiteDomain: null };

function world() {
  const w = { fetches: [], inserts: [], creates: [], seq: 0 };
  // Every outbound request is recorded; the provider "fails" (503) so canonical creation is proven independent of metadata.
  const fetchMock = async (input, init = {}) => {
    w.fetches.push({ url: String(input instanceof URL ? input.href : input), redirect: init.redirect });
    return new Response("unavailable", { status: 503 });
  };
  const videoDb = {
    isDbConfigured: () => true,
    createVideoCandidate: async (input) => {
      const dup = w.creates.find((c) => c.normalizedSourceUrl === input.normalizedSourceUrl);
      if (dup) return { candidate: dup, duplicate: true };
      const row = { id: `vc-${++w.seq}`, status: "needs_review", createdAt: "t", updatedAt: "t", ...input };
      w.creates.push(row);
      return { candidate: row, duplicate: false };
    },
    getAssociationSummaries: async (list) => Object.fromEntries(list.map((v) => [v.id, { kind: "none", problems: [] }])),
    listVideoCandidates: async () => [],
    patchVideoCandidate: async (id) => ({ ok: true, candidate: w.creates.find((c) => c.id === id) }),
    attachVideoCandidate: async () => ({ ok: false, code: "not-approved" }),
  };
  const sb = createSandbox({
    root,
    env: { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT }, // no INSTAGRAM_OEMBED_TOKEN / YOUTUBE_API_KEY
    globals: { fetch: fetchMock },
    overrides: {
      "lib/db/index.ts": { isDbConfigured: () => true, getDb: () => null },
      "lib/db/videoCandidates.ts": videoDb,
      "lib/db/identity.ts": { getCandidateRef: async () => null, getPublishedRefBySlug: async () => null },
      "lib/db/videos.ts": { getActiveVideos: async () => [], insertVideo: async (rid, v) => { w.inserts.push(v); return v; } },
      "lib/db/restaurants.ts": { getAppRestaurantById: async (s) => (s === "semma" ? RESTAURANT : null) },
      "lib/discovery/searchProvider.ts": {
        SearchAuthError: class SearchAuthError extends Error {},
        braveProvider: {
          isConfigured: () => true,
          search: async (q) => [
            ...SHORTS.map((url, i) => ({ url, title: `short ${i}`, description: "d", provider: "brave", rank: i + 1, query: q })),
            { url: CANON.tiktok, title: "canon", description: "d", provider: "brave", rank: 9, query: q },
          ],
        },
      },
    },
  });
  w.route = (p) => sb.load(`app/api/admin/${p}/route.ts`);
  return w;
}
async function post(route, body, { secret = DRAFT, slug = "semma" } = {}) {
  const res = await route.POST(new Request("https://admin.example.test/api/admin/x", {
    method: "POST", headers: { "content-type": "application/json", "x-foodswipe-admin-secret": secret }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ slug, id: "id-1" }) });
  return { status: res.status, body: await res.json() };
}
const CANON_MSG = /full tiktok\.com\/@user\/video\//;

// ---- 1. draft intake POST /api/admin/videos/candidates ----
for (const url of SHORTS) {
  const w = world();
  const r = await post(w.route("videos/candidates"), { sourceUrl: url });
  eq([r.status, r.body.code], [422, "unsupported_url"], `candidates POST: short link refused 422 (${url})`);
  ok(CANON_MSG.test(r.body.error ?? r.body.message ?? JSON.stringify(r.body)), "candidates POST: asks for the canonical link");
  eq(w.fetches, [], "candidates POST: ZERO fetches (no hop, no oEmbed)");
  eq(w.creates, [], "candidates POST: ZERO inserts");
}
{
  const w = world(); const route = w.route("videos/candidates");
  for (const [platform, url] of Object.entries(CANON)) {
    const r = await post(route, { sourceUrl: url });
    eq(r.status, 201, `candidates POST: canonical ${platform} still creates with provider metadata unavailable`);
    eq(r.body.candidate.platform, platform, `candidate platform ${platform}`);
    ok(r.body.candidate.embedUrl, `candidate ${platform} keeps its official embed`);
  }
  eq(w.creates.length, 3, "three canonical candidates inserted");
  eq(w.fetches.map((f) => f.url), [`https://www.tiktok.com/oembed?url=${encodeURIComponent(CANON.tiktok)}`], "only the fixed TikTok oEmbed endpoint was requested (it 'failed'; Instagram/YouTube had no credentials)");
  ok(w.fetches.every((f) => f.redirect === "manual"), "provider request used redirect:manual");
  eq(w.creates.find((c) => c.platform === "tiktok").resolverStatus, "error", "tiktok candidate recorded the metadata failure");
}

// ---- 2. profile-editor POST /api/admin/restaurants/[slug]/videos (publish credential) ----
for (const url of SHORTS) {
  const w = world();
  const r = await post(w.route("restaurants/[slug]/videos"), { sourceUrl: url }, { secret: PUBLISH });
  eq([r.status, r.body.code], [422, "unsupported_url"], `profile videos POST: short link refused 422 (${url})`);
  eq([w.fetches, w.inserts, w.creates], [[], [], []], "profile videos POST: zero fetches, zero inserts");
}
{
  const w = world(); const route = w.route("restaurants/[slug]/videos");
  for (const [platform, url] of Object.entries(CANON)) {
    const r = await post(route, { sourceUrl: url }, { secret: PUBLISH });
    eq(r.status, 201, `profile videos POST: canonical ${platform} still 201 with metadata unavailable`);
  }
  eq(w.inserts.length, 3, "three canonical videos inserted");
}

// ---- 3. discovery/search (dry run) refuses short leads ----
{
  const w = world();
  const r = await post(w.route("restaurants/[slug]/discovery/search"), { maxQueries: 1, maxResultsPerQuery: 5 });
  eq(r.status, 200, "discovery search runs");
  const byUrl = Object.fromEntries(r.body.leads.map((l) => [l.url, l]));
  for (const url of SHORTS) {
    const lead = byUrl[url];
    ok(lead && lead.resolverStatus === "failed" && CANON_MSG.test(lead.resolverError), `discovery search: short lead refused with the canonical instruction (${url})`);
    ok(!lead.platformVideoId && !lead.embedUrl, "refused short lead carries no identity or embed");
  }
  ok(byUrl[CANON.tiktok].platformVideoId === VID, "discovery search: canonical lead still resolves its identity");
  eq(w.fetches.map((f) => f.url), [`https://www.tiktok.com/oembed?url=${encodeURIComponent(CANON.tiktok)}`], "discovery search: the only request is the canonical lead's oEmbed (short leads caused none)");
  eq(w.creates, [], "discovery search writes nothing");
}

// ---- 4. discovery/candidates (selected leads) refuses short leads, creates canonical ----
{
  const w = world();
  const r = await post(w.route("restaurants/[slug]/discovery/candidates"), { leads: [...SHORTS.map((url) => ({ url })), { url: CANON.tiktok }] });
  eq(r.status, 200, "discovery candidates responds");
  eq(r.body.failed.map((f) => f.url).sort(), [...SHORTS].sort(), "discovery candidates: every short lead is in `failed`");
  ok(r.body.failed.every((f) => CANON_MSG.test(f.error)), "discovery candidates: failure text asks for the canonical link");
  eq(r.body.created.length, 1, "only the canonical lead was created");
  eq(w.creates.map((c) => c.normalizedSourceUrl), [CANON.tiktok], "only the canonical lead was inserted");
  eq(w.fetches.map((f) => f.url), [`https://www.tiktok.com/oembed?url=${encodeURIComponent(CANON.tiktok)}`], "short leads made zero requests");
}

// ---- 5. UI source guards (no DOM harness exists in this repo; behaviour is browser-QA'd separately) ----
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const form = strip(readFileSync(resolve(root, "components/AdminVideoCandidates.tsx"), "utf8"));
  const picker = strip(readFileSync(resolve(root, "components/AdminRestaurantPicker.tsx"), "utf8"));
  const fn = (name) => { const a = form.indexOf(`function ${name}`); return form.slice(a, form.indexOf("\n  }\n", a)); };
  const submit = fn("submitIntake"), change = fn("changeSecret");
  ok(!/setIntakePick\(/.test(submit), "intake success/failure/duplicate never clears or changes the selected restaurant (only the explicit Change does)");
  ok(/setSourceUrl\(""\)/.test(submit) && /setIntakeNotes\(""\)/.test(submit), "success clears the URL and the note");
  const failBranch = submit.slice(submit.indexOf("if (!res.ok || !data.candidate)"), submit.indexOf("setIntakeMsg({ type: \"ok\""));
  ok(!/setSourceUrl|setIntakeNotes|setIntakeProposed/.test(failBranch), "a failed submission preserves every input");
  ok(/const target = intakePick/.test(submit) && /target\?\.kind/.test(submit) && !/intakePick\??\.kind/.test(submit), "the target is captured once and the request uses the captured value");
  ok(/disabled=\{submitting\}/.test(form.slice(form.indexOf("<AdminRestaurantPicker key={credEpoch}"), form.indexOf("<AdminRestaurantPicker key={credEpoch}") + 260)), "the picker is frozen while saving");
  ok((form.match(/disabled=\{submitting\}/g) ?? []).length >= 4, "URL, picker, proposed name and notes are all frozen while saving");
  ok((submit.match(/mine !== intakeSeq\.current/g) ?? []).length >= 2 && (submit.match(/mine === intakeSeq\.current/g) ?? []).length >= 2, "stale intake responses are ignored (after the response, after the reload, and in catch/finally)");
  for (const needle of ["loadSeq.current++", "intakeSeq.current++", "setList([])", "setAdminScope(null)", "setIntakePick(null)", "setExpandedId(null)", "setActionMsg(null)", "setIntakeMsg(null)", "setSubmitting(false)", "setCredEpoch"]) {
    ok(change.includes(needle), `changing the credential resets: ${needle}`);
  }
  ok(/key=\{credEpoch\}/.test(form), "the picker remounts on a credential change (drops its search state)");
  ok(!/method:\s*["']PATCH["']/.test(submit), "duplicate handling never relinks or patches the existing lead");
  ok(/Already in the queue — lead \$\{existing\.id\}, status \$\{status\}, \$\{where\}/.test(submit), "duplicate message names the existing lead id, status and known link");
  ok(/rows\?\.some\(\(c\) => c\.id === existing\.id\)/.test(submit), "the lead is opened only if it is really in the loaded rows");
  ok(/setStatusFilter\(knownStatus\)/.test(submit) && /It is not in the list that loaded/.test(submit), "a hidden duplicate is surfaced by switching filter, else an explicit open-by-ID path");
  ok(!/truncate[^>]*>\s*\{value\.kind/.test(picker) && (picker.match(/break-words/g) ?? []).length >= 2, "full branch addresses wrap in the selected row and in results");
  // (1) picker cannot change the target while saving
  const pickFn = picker.slice(picker.indexOf("function pick("), picker.indexOf("return (", picker.indexOf("function pick(")));
  ok(/if \(disabled\) return/.test(pickFn), "picker selection handler refuses while disabled/saving");
  ok(/open && !disabled/.test(picker) && /<button type="button" disabled=\{disabled\} onClick=\{\(\) => pick\(row\)\}/.test(picker), "open results are hidden and their buttons disabled while saving");
  const selFn = fn("selectIntakePick");
  ok(/if \(submittingRef\.current\) return/.test(selFn) && /onChange=\{selectIntakePick\}/.test(form), "the parent also ignores any selection while a save is in flight (covers delayed picker interactions)");
  ok(submit.indexOf("submittingRef.current = true") > -1 && submit.indexOf("submittingRef.current = true") < submit.indexOf("await fetch"), "the in-flight flag is set synchronously before the request");
  // (2) late row callbacks from an earlier credential generation are dropped
  ok(change.includes("epochRef.current++") && change.includes("submittingRef.current = false"), "credential change bumps the generation and clears the in-flight flag");
  ok(/function onChangedFor\(gen: number[^)]*\) \{\s*if \(gen !== epochRef\.current\) return;/.test(form) && /onChanged=\{\(u\) => onChangedFor\(credEpoch, u\)\}/.test(form), "row save/relink/attach callbacks are bound to the generation they rendered under");
  // (3) a direct lead link finds its row whatever the status, without a secret in the URL
  const loadFn = fn("load");
  ok(/linked && !deepLinkHandled\.current && !loadedOnce/.test(loadFn) && /status = "all"/.test(loadFn) && /platform = "all"/.test(loadFn), "first authenticated load of a ?candidate= link widens the filters to All");
  ok(!/secret/.test(submit.slice(submit.indexOf("const href"), submit.indexOf("const href") + 120)) && !/[?&]secret=/.test(form), "the open-by-ID link carries only the candidate id, never the secret");
  ok(/setExpandedId\(wanted\)/.test(loadFn), "the linked row is expanded after the load");
  ok(/aria-label="Change restaurant"/.test(picker), "the selected restaurant has an explicit Change control");
}

console.log(`social-intake-route-check: ${checks} checks passed`);
