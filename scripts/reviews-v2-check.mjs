// Run with node scripts/reviews-v2-check.mjs. No network, database or browser.
//
// Phase 15B logic behind Creator Reviews v2: frame shape, creator fallback, the iframe URL we hand
// a provider, how provider messages are read, and source-level guards on the rules that must not regress
// (one provider iframe, no autoplay, no overlay on a live player, no custom playback or media access).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(read(path + ".ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { URL, exports, JSON, Math, Number, Object, String, Set }, { filename: path });
  return exports;
}
const media = load("lib/reviewMedia");
// The module runs in its own VM realm; compare plain data.
const sig = (...args) => JSON.parse(JSON.stringify(media.parseProviderSignal(...args)));

test("frame shape follows the provider, not a forced ratio", () => {
  assert.equal(media.reviewFrame({ platform: "TikTok" }), "portrait");
  assert.equal(media.reviewFrame({ platform: "Instagram" }), "post");
  assert.equal(media.reviewFrame({ platform: "YouTube", sourceUrl: "https://www.youtube.com/watch?v=abc" }), "landscape");
  assert.equal(media.reviewFrame({ platform: "YouTube", sourceUrl: "https://www.youtube.com/shorts/abc" }), "portrait");
  assert.equal(media.reviewFrame({ platform: "Web" }), "landscape");
});

test("a stored @unknown is not a creator; fall back to the link, then the display name", () => {
  const link = "https://www.tiktok.com/@mostasting/video/7458835434269871390";
  assert.equal(media.reviewCreatorName({ creatorHandle: "@unknown", sourceUrl: link }), "@mostasting");
  assert.equal(media.reviewCreatorName({ creatorHandle: "@chef", sourceUrl: link }), "@chef");
  assert.equal(media.reviewCreatorName({ creatorHandle: "@unknown", creatorDisplayName: "Chef Ann" }), "Chef Ann");
  assert.equal(media.reviewCreatorName({ creatorHandle: "@unknown" }), null);
  assert.equal(media.reviewCreatorName({ creatorHandle: "  " }), null);
  assert.equal(media.reviewTitle(null, "TikTok"), "TikTok review");
  assert.equal(media.reviewTitle("@a", "TikTok"), "TikTok review by @a");
});

test("origin labels: a real attached post is not called a demo", () => {
  const real = { sourceType: "real-post", isRealSource: true };
  assert.equal(media.reviewOriginLabel("shared", real), undefined);
  assert.equal(media.reviewOriginLabel("seed", real), undefined);
  assert.equal(media.reviewOriginLabel("local", real), "Local clip");
  assert.equal(media.reviewOriginLabel("shared", { sourceType: "manual-seed", isRealSource: false }), "Demo clip");
  assert.equal(media.reviewOriginLabel("shared", { sourceType: "real-post", isRealSource: false }), "Demo clip");
});

test("only YouTube URLs are changed, never with autoplay", () => {
  const tiktok = "https://www.tiktok.com/player/v1/7458835434269871390";
  const ig = "https://www.instagram.com/p/CuE2WNQs6vH/embed";
  assert.equal(media.reviewEmbedSrc(tiktok, "https://example.com"), tiktok);
  assert.equal(media.reviewEmbedSrc(ig, "https://example.com"), ig);
  const yt = new URL(media.reviewEmbedSrc("https://www.youtube-nocookie.com/embed/M7lc1UVf-VE", "https://example.com"));
  assert.equal(yt.hostname, "www.youtube-nocookie.com");
  assert.equal(yt.searchParams.get("origin"), "https://example.com");
  assert.equal(yt.searchParams.get("enablejsapi"), "1");
  assert.equal(yt.searchParams.get("playsinline"), "1");
  assert.equal(yt.searchParams.has("autoplay"), false);
  const noOrigin = new URL(media.reviewEmbedSrc("https://www.youtube-nocookie.com/embed/M7lc1UVf-VE", null));
  assert.equal(noOrigin.searchParams.has("enablejsapi"), false);
});

test("provider messages: observed TikTok errors, YouTube errors, Instagram height; everything else ignored", () => {
  const tt = "https://www.tiktok.com";
  assert.deepEqual(sig("TikTok", tt, '{"type":"onPlayerError","value":{"errorCode":1001},"x-tiktok-player":true}'), { kind: "error", detail: "onPlayerError" });
  assert.deepEqual(sig("TikTok", tt, '{"type":"onError","value":1,"x-tiktok-player":true}'), { kind: "error", detail: "onError" });
  assert.equal(sig("TikTok", tt, "[tea-sdk]ready"), null);
  assert.equal(sig("TikTok", tt, '{"type":"onPlayerError"}'), null, "not from the player");
  assert.equal(sig("TikTok", "https://evil.example", '{"type":"onPlayerError","x-tiktok-player":true}'), null);
  assert.deepEqual(sig("YouTube", "https://www.youtube-nocookie.com", '{"event":"onError","info":153}'), { kind: "error", detail: "youtube-153" });
  assert.equal(sig("YouTube", "https://www.youtube-nocookie.com", '{"event":"onReady"}'), null);
  assert.equal(sig("YouTube", "https://evil.example", '{"event":"onError","info":2}'), null);
  const ig = "https://www.instagram.com";
  assert.deepEqual(sig("Instagram", ig, '{"details":{"height":637},"type":"MEASURE"}'), { kind: "measure", height: 637 });
  assert.deepEqual(sig("Instagram", ig, { type: "MEASURE", details: { height: 5000 } }), { kind: "measure", height: 900 });
  assert.deepEqual(sig("Instagram", ig, { type: "MEASURE", details: { height: 10 } }), { kind: "measure", height: 420 });
  assert.equal(sig("Instagram", ig, '{"type":"MEASURE","details":{"height":"x"}}'), null);
  assert.equal(sig("Instagram", ig, "not json"), null);
  assert.equal(sig("TikTok", ig, '{"type":"onPlayerError","x-tiktok-player":true}'), null, "wrong origin for platform");
});

test("source guards: one iframe, no autoplay, no overlay on a live player", () => {
  const player = read("components/reviews/ReviewPlayer.tsx");
  assert.equal((player.match(/<iframe\b/g) ?? []).length, 1, "ReviewPlayer renders exactly one iframe element");
  assert.doesNotMatch(player, /autoplay=|autoPlay|\.play\(/, "no autoplay URL parameter or script");
  assert.match(player, /allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"/, "iframe permission policy is unchanged");
  assert.doesNotMatch(player, /setTimeout\([^)]*,\s*(700|1000)\)/, "no fixed readiness delay");
  for (const file of ["ReviewPlayer", "ReviewAttribution"]) {
    assert.doesNotMatch(read(`components/reviews/${file}.tsx`), /VideoEmbed|<video\b|fetch\(|backdrop-blur|absolute inset-x-0 bottom-0/, `${file} does not rehost, fetch or overlay`);
  }
  const creator = read("components/CreatorReviews.tsx");
  assert.doesNotMatch(creator, /VideoEmbed/);
  assert.doesNotMatch(read("components/RestaurantProfileView.tsx"), /ReviewClipCard|VideoEmbed/);
  assert.doesNotMatch(read("components/RestaurantVideos.tsx"), /aspect-\[4\/5\]/, "no forced 4:5 review frame");
});

test("source guards: Swipe shows the featured player inline, kept out of the card's drag, with no viewer", () => {
  const creator = read("components/CreatorReviews.tsx");
  assert.match(creator, /load=\{chosen \? "immediate" : "when-visible"\}/, "the featured review loads when it is near the viewport");
  assert.match(creator, /onPointerDown=\{dragInert \? \(event\) => event\.stopPropagation\(\) : undefined\}/);
  assert.match(creator, /touchAction: "auto"/);
  const view = read("components/RestaurantProfileView.tsx");
  assert.match(view, /<CreatorReviews items=\{profileVideos\.videos\} analytics=\{analyticsContext\} tone="dark" \/>/);
  assert.doesNotMatch(view, /showModal|<dialog/);
});
