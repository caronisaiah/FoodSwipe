// Run with node scripts/gallery-ui-check.mjs. No network, database or browser.
//
// Phase 13C logic behind the Swipe v2 gallery: the image prewarm that must never mark a slow
// photo failed, gallery loading state, validation against the displayed hero, the session
// cache, and tap-versus-drag detection.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const compiled = new Map();
function load(path, dependencies = {}) {
  if (!compiled.has(path)) {
    const source = readFileSync(new URL("../" + path + ".ts", import.meta.url), "utf8");
    compiled.set(path, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
  }
  const exports = {};
  runInNewContext(compiled.get(path), {
    URL, exports, Promise, Map, Set, Math, Number, Array, Object, JSON,
    require(name) {
      assert(Object.hasOwn(dependencies, name), "Unexpected dependency " + name);
      return dependencies[name];
    },
  }, { filename: path });
  return exports;
}

const placePhoto = load("lib/placePhoto");
const clientGallery = load("lib/clientGallery", { "./placePhoto": placePhoto });
const galleryState = load("lib/galleryState", { "./clientGallery": clientGallery });
const tapGesture = load("lib/tapGesture");
const prewarm = load("lib/heroImagePrewarm");
const heroMedia = load("lib/clientHeroMedia", { "@/lib/placePhoto": placePhoto });
const photoLoad = load("lib/placePhotoLoad", {});
const heroFallback = load("lib/heroFallback", {});

const photo = (ref, authors = [{ displayName: "Author " + ref }]) => ({
  sourceProvider: "google_places",
  googleMapsUri: "https://www.google.com/maps/photo/" + ref,
  photoUri: "https://images.example/" + ref + "?t=" + Math.random(),
  attributions: authors,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

/* ------------------------------ image prewarm ------------------------------ */

function prewarmFixture(maxWait = 5000) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const images = [];
  const env = {
    createImage() {
      const image = { onload: null, onerror: null, referrerPolicy: "", decoding: "", src: "", complete: false, naturalWidth: 0 };
      images.push(image);
      return image;
    },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    images,
    prewarmer: prewarm.createHeroImagePrewarmer(env, maxWait),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a photo that loads after the prewarm timeout is not marked failed and still appears", async () => {
  const { prewarmer, images, advance } = prewarmFixture();
  const waiting = prewarmer.prewarm("pizza", "https://images.example/slow");
  advance(5000);
  // The wait ended, but the verdict is "slow", never "error": the caller keeps the photo.
  assert.equal(await waiting, "slow");
  assert.equal(prewarm.prewarmDiscardsPhoto("slow"), false);
  assert.equal(prewarmer.outcome("pizza", "https://images.example/slow"), "pending");

  // The image finishes later. Its result is recorded and nothing discards it.
  images[0].onload();
  await settle();
  assert.equal(prewarmer.outcome("pizza", "https://images.example/slow"), "ready");
  assert.equal(await prewarmer.prewarm("pizza", "https://images.example/slow"), "ready");
  assert.equal(images.length, 1, "no second download was started");
});

test("only a genuine load error discards a photo", async () => {
  assert.deepEqual(["ready", "slow", "error"].map(prewarm.prewarmDiscardsPhoto), [false, false, true]);
  const { prewarmer, images } = prewarmFixture();
  const waiting = prewarmer.prewarm("pizza", "https://images.example/broken");
  images[0].onerror();
  assert.equal(await waiting, "error");
  assert.equal(prewarmer.outcome("pizza", "https://images.example/broken"), "error");

  // An error that arrives after the wait ended is still recorded as an error.
  const late = prewarmFixture();
  const lateWait = late.prewarmer.prewarm("tacos", "https://images.example/late-error");
  late.advance(5000);
  assert.equal(await lateWait, "slow");
  late.images[0].onerror();
  await settle();
  assert.equal(late.prewarmer.outcome("tacos", "https://images.example/late-error"), "error");
});

test("while a slow image is still loading, asking again waits without starting another request", async () => {
  const { prewarmer, images, advance } = prewarmFixture();
  const first = prewarmer.prewarm("pizza", "https://images.example/a");
  assert.equal(prewarmer.prewarm("pizza", "https://images.example/a"), prewarmer.prewarm("pizza", "https://images.example/a"));
  advance(5000);
  await first;
  assert.equal(await prewarmer.prewarm("pizza", "https://images.example/a"), "slow");
  assert.equal(images.length, 1);
});

test("a fast image settles at once and the timer is cleared", async () => {
  const { prewarmer, images, advance } = prewarmFixture();
  const waiting = prewarmer.prewarm("pizza", "https://images.example/fast");
  assert.equal(images[0].referrerPolicy, "no-referrer");
  images[0].onload();
  assert.equal(await waiting, "ready");
  advance(10_000); // a stale timer must not change anything
  assert.equal(prewarmer.outcome("pizza", "https://images.example/fast"), "ready");
});

test("forgetting a restaurant drops its images, and a late finish does not bring them back", async () => {
  const { prewarmer, images } = prewarmFixture();
  void prewarmer.prewarm("old", "https://images.example/o");
  void prewarmer.prewarm("keep", "https://images.example/k");
  prewarmer.retainOnly(new Set(["keep"]));
  images[0].onload();
  await settle();
  assert.equal(prewarmer.outcome("old", "https://images.example/o"), undefined);
  assert.equal(prewarmer.outcome("keep", "https://images.example/k"), "pending");
});

/* --------------------------- gallery count & photos --------------------------- */

test("galleryCount is a whole number from 0 to 3 and older servers mean no gallery", () => {
  for (const [input, expected] of [[0, 0], [1, 1], [2, 2], [3, 3], [9, 3], [-1, 0], [1.5, 0], ["3", 0], [null, 0], [undefined, 0]]) {
    assert.equal(heroMedia.normalizeGalleryCount(input), expected, String(input));
  }
  const media = heroMedia.normalizeClientHeroMedia("pizza", { photo: photo("a"), logoUrl: null, status: "ok" });
  assert.equal(media.galleryCount, 0);
  assert.equal(heroMedia.normalizeClientHeroMedia("pizza", { photo: photo("a"), galleryCount: 3 }).galleryCount, 3);
});

test("the gallery response is validated photo by photo, and only against the hero on screen", () => {
  const hero = photo("hero");
  const body = {
    heroSourceUri: hero.googleMapsUri,
    photos: [photo("a"), { ...photo("b"), attributions: undefined }, { ...photo("c"), googleMapsUri: "http://insecure.example" }, photo("d")],
  };
  const parsed = clientGallery.normalizeGalleryResponse(body);
  assert.deepEqual(plain(parsed.photos.map((p) => p.googleMapsUri.split("/").at(-1))), ["a", "d"]);
  assert.deepEqual(plain(clientGallery.extrasForHero(hero, parsed)).map((p) => p.googleMapsUri.split("/").at(-1)), ["a", "d"]);

  for (const bad of [null, "text", {}, { photos: "no" }]) assert.equal(clientGallery.normalizeGalleryResponse(bad), null);
  // Built around a different hero, or around none: nothing is shown rather than guessed.
  assert.equal(clientGallery.extrasForHero(hero, { ...parsed, heroSourceUri: "https://www.google.com/maps/photo/other" }), null);
  assert.equal(clientGallery.extrasForHero(hero, { ...parsed, heroSourceUri: null }), null);
});

test("duplicates are removed by photo identity, the hero is never repeated and the total is three", () => {
  const hero = photo("hero");
  const parsed = clientGallery.normalizeGalleryResponse({
    heroSourceUri: hero.googleMapsUri,
    photos: [photo("hero"), photo("a"), { ...photo("a"), photoUri: "https://images.example/other-url" }, photo("b"), photo("c")],
  });
  const extras = clientGallery.extrasForHero(hero, parsed);
  assert.deepEqual(plain(extras.map((p) => p.googleMapsUri.split("/").at(-1))), ["a", "b"]);
  assert.equal(1 + extras.length, 3);
});

test("the session cache expires, is bounded and is memory only", () => {
  let now = 0;
  const cache = clientGallery.createGalleryCache(() => now, 1000, 2);
  const entry = { photos: [photo("a")], heroSourceUri: "https://www.google.com/maps/photo/h" };
  cache.set("a", entry);
  cache.set("b", entry);
  cache.set("c", entry);
  assert.equal(cache.get("a"), undefined, "the oldest entry is evicted");
  assert.equal(cache.size(), 2);
  now = 999;
  assert.equal(cache.get("b"), entry);
  now = 1001;
  assert.equal(cache.get("b"), undefined, "an expired image URL is not reused");
  assert.equal(cache.size(), 1);
});

/* ------------------------------- gallery state ------------------------------- */

const hero = photo("hero");
const keyFor = (id, h = hero) => galleryState.galleryKey(id, h);
const start = (id = "pizza") => galleryState.initialGallery(keyFor(id), hero.googleMapsUri);
const reduce = (state, ...events) => events.reduce(galleryState.reduceGallery, state);
const ids = (state) => plain(galleryState.visibleIds(state).map((id) => id.split("/").at(-1)));

test("nothing claims more than one photo until the gallery has loaded", () => {
  const idle = start();
  const shown = galleryState.selectGallery(idle, hero);
  assert.deepEqual([shown.confirmedCount, shown.canStep, shown.index, shown.photos.length], [1, false, 0, 1]);
  const loading = reduce(idle, { type: "request", key: idle.key, step: 1 });
  assert.deepEqual([loading.phase, galleryState.selectGallery(loading, hero).canStep], ["loading", false]);
});

test("first interaction loads once, then steps through three photos and cycles", () => {
  const key = keyFor("pizza");
  let state = reduce(start(), { type: "request", key, step: 1 });
  // A second tap while the first is loading does not start another request or change anything.
  assert.equal(reduce(state, { type: "request", key, step: 1 }), state);
  state = reduce(state, { type: "loaded", key, extras: [photo("a"), photo("b")] });
  let view = galleryState.selectGallery(state, hero);
  assert.deepEqual([state.phase, view.index, view.photos.length, view.canStep], ["ready", 1, 3, true]);
  assert.equal(view.current.googleMapsUri, "https://www.google.com/maps/photo/a");
  state = reduce(state, { type: "step", key, step: 1 });
  assert.equal(galleryState.selectGallery(state, hero).index, 2);
  state = reduce(state, { type: "step", key, step: 1 });
  assert.equal(galleryState.selectGallery(state, hero).index, 0, "after the last photo comes the first");
  state = reduce(state, { type: "step", key, step: -1 });
  assert.equal(galleryState.selectGallery(state, hero).index, 2, "previous from the first goes to the last");
});

test("going back on the very first interaction lands on the last photo", () => {
  const key = keyFor("pizza");
  const state = reduce(start(), { type: "request", key, step: -1 }, { type: "loaded", key, extras: [photo("a"), photo("b")] });
  assert.equal(galleryState.selectGallery(state, hero).index, 2);
});

test("an answer for another restaurant or another hero can never change this one", () => {
  const key = keyFor("pizza");
  const loading = reduce(start("pizza"), { type: "request", key, step: 1 });
  const stale = keyFor("tacos");
  for (const event of [
    { type: "loaded", key: stale, extras: [photo("x")] },
    { type: "unavailable", key: stale }, { type: "failed", key: stale },
    { type: "step", key: stale, step: 1 }, { type: "drop", key: stale, id: hero.googleMapsUri },
  ]) assert.equal(galleryState.reduceGallery(loading, event), loading);
  // The same restaurant with a different hero is a different gallery too.
  assert.notEqual(keyFor("pizza", photo("another")), key);
  // Moving to another restaurant resets everything, including the selected photo.
  const ready = reduce(loading, { type: "loaded", key, extras: [photo("a")] });
  const moved = galleryState.reduceGallery(ready, { type: "reset", key: keyFor("tacos"), heroId: hero.googleMapsUri });
  assert.deepEqual([moved.phase, moved.index, moved.extras.length], ["idle", 0, 0]);
});

test("one-, two- and three-photo restaurants show only what was returned", () => {
  const key = keyFor("pizza");
  const none = reduce(start(), { type: "request", key, step: 1 }, { type: "loaded", key, extras: [] });
  assert.equal(none.phase, "unavailable");
  assert.deepEqual([galleryState.selectGallery(none, hero).canStep, galleryState.selectGallery(none, hero).photos.length], [false, 1]);
  const two = reduce(start(), { type: "request", key, step: 1 }, { type: "loaded", key, extras: [photo("a")] });
  assert.equal(galleryState.selectGallery(two, hero).photos.length, 2);
  const many = reduce(start(), { type: "request", key, step: 1 }, { type: "loaded", key, extras: [photo("a"), photo("b"), photo("c")] });
  assert.equal(galleryState.selectGallery(many, hero).photos.length, 3, "never more than three in total");
});

test("a failed request may be retried by a deliberate interaction, an unavailable gallery may not", () => {
  const key = keyFor("pizza");
  let state = reduce(start(), { type: "request", key, step: 1 }, { type: "failed", key });
  assert.equal(state.phase, "error");
  state = reduce(state, { type: "request", key, step: 1 });
  assert.equal(state.phase, "loading");
  const unavailable = reduce(state, { type: "unavailable", key });
  assert.equal(reduce(unavailable, { type: "request", key, step: 1 }), unavailable);
});

test("a photo that fails to load leaves the gallery and the index stays valid", () => {
  const key = keyFor("pizza");
  let state = reduce(start(), { type: "request", key, step: 1 }, { type: "loaded", key, extras: [photo("a"), photo("b")] });
  state = reduce(state, { type: "step", key, step: 1 });               // on the last photo (index 2)
  state = reduce(state, { type: "drop", key, id: "https://www.google.com/maps/photo/b" });
  const view = galleryState.selectGallery(state, hero);
  assert.deepEqual([view.photos.length, view.index], [2, 1]);
  assert.deepEqual(ids(state), ["hero", "a"]);
  state = reduce(state, { type: "drop", key, id: "https://www.google.com/maps/photo/a" });
  assert.deepEqual([galleryState.selectGallery(state, hero).canStep, ids(state)], [false, ["hero"]]);
  // Dropping the same or an unknown photo again changes nothing.
  assert.equal(galleryState.reduceGallery(state, { type: "drop", key, id: "https://www.google.com/maps/photo/a" }), state);
});

test("each photo carries its own credit through every step", () => {
  const credits = [photo("a", [{ displayName: "Ann" }, { displayName: "Bo" }]), photo("b", [{ displayName: "Cy" }])];
  const key = keyFor("pizza");
  let state = reduce(start(), { type: "request", key, step: 1 }, { type: "loaded", key, extras: credits });
  const authors = () => galleryState.selectGallery(state, hero).current.attributions.map((a) => a.displayName);
  assert.deepEqual(authors(), ["Ann", "Bo"]);
  state = reduce(state, { type: "step", key, step: 1 });
  assert.deepEqual(authors(), ["Cy"]);
  state = reduce(state, { type: "step", key, step: 1 });
  assert.deepEqual(authors(), ["Author hero"]);
});

/* ------------------------------ tap detection ------------------------------ */

test("a quick press that stays put is a tap; drags, long presses, pinches and cancels are not", () => {
  const t = tapGesture;
  const press = (x = 100, y = 100, time = 0) => t.startTap(1, x, y, time);
  assert.equal(t.isTap(press(), 1, 102, 101, 120), true);
  assert.equal(t.isTap(press(), 1, 100 + t.TAP_MAX_MOVE_PX, 100, 120), true);
  assert.equal(t.isTap(press(), 1, 100 + t.TAP_MAX_MOVE_PX + 1, 100, 120), false, "a drag that ends on a photo is not a tap");
  assert.equal(t.isTap(press(), 1, 100, 100 + t.TAP_MAX_MOVE_PX + 1, 120), false, "a vertical scroll is not a tap");
  assert.equal(t.isTap(press(), 1, 100, 100, t.TAP_MAX_DURATION_MS + 1), false, "a long press is not a tap");
  assert.equal(t.isTap(t.addTouch(press()), 1, 100, 100, 100), false, "a pinch is not a tap");
  assert.equal(t.isTap(press(), 2, 100, 100, 100), false, "another finger lifting is not this tap");
  // A drag that wanders away and returns to the start is still a drag.
  const wandered = t.moveTap(t.moveTap(press(), 1, 160, 100), 1, 100, 100);
  assert.equal(t.isTap(wandered, 1, 100, 100, 120), false);
  // Movement from another pointer is ignored.
  assert.equal(t.moveTap(press(), 2, 900, 900).maxTravel, 0);
});

/* ------------------- presented position (Phase 14D: pending vs displayed) ------------------- */

test("the indicator and announcement follow the photo on screen, not the one requested", () => {
  const a = photo("a"), b = photo("b"), c = photo("c");
  const photos = [a, b, c];
  // Photo 2 was requested (index 1) but photo 1 is still what the person sees, with photo 1's credit.
  assert.equal(galleryState.presentedIndex(photos, a, 1), 0, "the original bug: position 2 was highlighted over photo 1");
  assert.equal(galleryState.presentedIndex(photos, b, 1), 1, "it moves once photo 2 is displayed");
  assert.equal(galleryState.presentedIndex(photos, c, 0), 2, "matched by the photo's own Maps link, whatever was requested");
  // A different image URL for the same photo is still the same photo.
  assert.equal(galleryState.presentedIndex(photos, { ...b, photoUri: "https://images.example/new" }, 0), 1);
  // Nothing shown yet, or the shown photo left the gallery (it failed): fall back to the requested index, kept in range.
  assert.equal(galleryState.presentedIndex(photos, null, 2), 2);
  assert.equal(galleryState.presentedIndex(photos, photo("gone"), 7), 2);
  assert.equal(galleryState.presentedIndex([], null, 3), 0);
});

test("a rapid next/next/previous never leaves the indicator ahead of the credited photo", () => {
  const photos = [photo("a"), photo("b"), photo("c")];
  const key = galleryState.galleryKey("pizza", photos[0]);
  let state = galleryState.initialGallery(key, photos[0].googleMapsUri);
  const run = (...events) => events.reduce(galleryState.reduceGallery, state);
  state = run({ type: "request", key, step: 1 }, { type: "loaded", key, extras: photos.slice(1) });
  // The person taps quickly: the requested index races ahead while only photo b has ever loaded.
  state = run({ type: "step", key, step: 1 }, { type: "step", key, step: -1 });
  const view = galleryState.selectGallery(state, photos[0]);
  assert.equal(view.index, 1, "requested position");
  assert.equal(galleryState.presentedIndex(view.photos, photos[1], view.index), 1, "b is displayed and credited");
  assert.equal(galleryState.presentedIndex(view.photos, photos[0], view.index), 0, "while a is still displayed, the indicator says a");
});

/* ------------------------- hero fallback policy (the logo flash) ------------------------- */

test("a slow photograph keeps a neutral surface; only a missing or failed one becomes a logo", () => {
  const photoA = photo("a");
  const key = photoLoad.photoLoadKey(photoA);
  const slow = photoLoad.reducePhotoLoad(photoLoad.initialPhotoLoad(key), { type: "slow", key });
  // The behaviour that was released: a photo past the 2 s patience asked for the logo underneath it.
  const released = (state, hasLogo) => (photoLoad.selectPhotoLoad(state, photoA).showFallback ? (hasLogo ? "logo" : "unavailable") : "none");
  assert.equal(released(slow, true), "logo", "reproduction: the logo appeared while the photograph was still on its way");

  const kind = (state, extra = {}) => {
    const view = photoLoad.selectPhotoLoad(state, photoA);
    return heroFallback.heroFallbackKind({ resolved: true, photoPending: view.attempted !== null, displayed: view.displayed !== null, hasLogo: true, ...extra });
  };
  assert.equal(kind(photoLoad.initialPhotoLoad(key)), "neutral");
  assert.equal(kind(slow), "neutral", "slow is still neutral");
  assert.equal(kind(photoLoad.reducePhotoLoad(slow, { type: "load", key })), "none");
  const failed = photoLoad.reducePhotoLoad(slow, { type: "error", key });
  assert.equal(kind(failed), "logo", "a photograph that really failed falls back to the logo");
  assert.equal(heroFallback.heroFallbackKind({ resolved: true, photoPending: false, displayed: false, hasLogo: false }), "unavailable");
  assert.equal(heroFallback.heroFallbackKind({ resolved: false, photoPending: false, displayed: false, hasLogo: true }), "neutral", "before the lookup answers there is nothing to fall back to");
  assert.equal(heroFallback.heroFallbackKind({ resolved: true, photoPending: false, displayed: true, hasLogo: true }), "none");
});

test("a photograph the deck already decoded starts displayed, and a real error or a late load still counts", () => {
  const photoA = photo("a");
  const key = photoLoad.photoLoadKey(photoA);
  const start = photoLoad.initialPhotoLoad(key, true);
  assert.equal(photoLoad.selectPhotoLoad(start, photoA).displayed, photoA, "no hidden loading frame");
  assert.equal(photoLoad.initialPhotoLoad(key, false).phase, "loading");
  assert.equal(photoLoad.initialPhotoLoad(null, true).phase, "loading", "nothing to assume without a photo");
  // The element's own load confirms it; an error (the cached bytes were gone) takes it back honestly.
  assert.equal(photoLoad.reducePhotoLoad(start, { type: "load", key }).assumed, undefined);
  const failed = photoLoad.reducePhotoLoad(start, { type: "error", key });
  assert.equal(photoLoad.selectPhotoLoad(failed, photoA).displayed, null);
  assert.equal(photoLoad.selectPhotoLoad(failed, photoA).attempted, null);
  // A confirmed image ignores a later stray error, as before.
  const confirmed = photoLoad.reducePhotoLoad(start, { type: "load", key });
  assert.equal(photoLoad.reducePhotoLoad(confirmed, { type: "error", key }), confirmed);
  // An answer about another photograph never applies, assumed or not.
  assert.equal(photoLoad.reducePhotoLoad(start, { type: "error", key: "other" }), start);
  // A reset to another photo can start assumed too.
  const next = photoLoad.reducePhotoLoad(photoLoad.initialPhotoLoad(key), { type: "reset", key: photoLoad.photoLoadKey(photo("b")), preloaded: true });
  assert.equal(next.phase, "loaded");
});
