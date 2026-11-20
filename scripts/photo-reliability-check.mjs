// Run with node scripts/photo-reliability-check.mjs. No network, database or browser.
//
// Covers: cache headers on the public photo and video routes, publication changes
// behind a cache, the photo load rules (failed, stalled, late answers, one photo
// per credit) and the hook that applies them, driven by a small hook harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
function loadSource(source, filename, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  runInNewContext(outputText, {
    ...globals,
    exports: compiled.exports,
    require: (specifier) => {
      assert(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
      return dependencies[specifier];
    },
  }, { filename });
  return compiled.exports;
}
const load = (relative, dependencies, globals) =>
  loadSource(readFileSync(root(relative), "utf8"), relative, dependencies, globals);

let checks = 0;
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function equal(actual, expected) {
  assert.deepEqual(plain(actual), plain(expected));
  checks++;
}
function ok(condition, message) {
  assert(condition, message);
  checks++;
}
function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

const photo = (id) => ({
  sourceProvider: "google_places",
  photoUri: `https://images.example/${id}`,
  googleMapsUri: `https://maps.example/photo/${id}`,
  attributions: [{ displayName: `Author ${id}`, uri: `https://maps.example/author/${id}` }],
});

// ---------------------------------------------------------------------------
// 1. Public photo and video routes: every response is uncacheable.
// ---------------------------------------------------------------------------
const NO_STORE = "no-store";
function photoRoute(options = {}) {
  const state = { restaurants: { ...(options.restaurants ?? {}) }, seeds: options.seeds ?? true, failLookup: false, failMedia: false };
  const calls = { lookups: [], selections: [], media: [] };
  const route = load("app/api/restaurants/[id]/photo/route.ts", {
    "@/lib/db/restaurants": {
      async getAppRestaurantById(id, opts) {
        calls.lookups.push([id, opts]);
        if (state.failLookup) throw new Error("database unavailable");
        return state.restaurants[id] ?? null;
      },
    },
    "@/lib/db/heroMediaSelections": {
      async getApprovedHeroSelectionForRestaurantSlug(id) {
        calls.selections.push(id);
        return null;
      },
    },
    "@/lib/contentMode": { shouldIncludeSeedRestaurants: () => state.seeds },
    "@/lib/heroMedia": {
      async resolveHeroMediaWithSelection(input) {
        calls.media.push(input);
        if (state.failMedia) throw new Error("upstream exploded");
        return { photo: photo("one"), photoStatus: "ok", logoUrl: "https://logos.example/one.png" };
      },
    },
  }, { Response });
  const get = (id) => route.GET(new Request(`https://example.test/api/restaurants/${id}/photo`), {
    params: Promise.resolve({ id }),
  });
  return { state, calls, get };
}
const cacheControl = (response) => response.headers.get("cache-control");

{
  const route = photoRoute({ restaurants: { pizza: { id: "pizza", googlePlaceId: "place-1", websiteDomain: "pizza.example" } } });
  const found = await route.get("pizza");
  equal([found.status, cacheControl(found)], [200, NO_STORE]);
  equal(await found.json(), { photo: photo("one"), status: "ok", logoUrl: "https://logos.example/one.png" });
  equal(route.calls.media, [{ googlePlaceId: "place-1", websiteDomain: "pizza.example", selectedHero: null }]);

  const missing = await route.get("nowhere");
  equal([missing.status, cacheControl(missing)], [404, NO_STORE]);
  equal(await missing.json(), { error: "Unknown restaurant." });
  equal(route.calls.media.length, 1);          // no Google lookup for a restaurant that is not public
  equal(route.calls.selections, ["pizza"]);    // nor a hero-selection lookup

  // A hidden or unpublished restaurant is indistinguishable from an unknown one.
  route.state.restaurants.hidden = undefined;
  const hidden = await route.get("hidden");
  equal([hidden.status, cacheControl(hidden), await hidden.json()], [404, NO_STORE, { error: "Unknown restaurant." }]);

  route.state.failLookup = true;
  const outage = await route.get("pizza");
  equal([outage.status, cacheControl(outage)], [503, NO_STORE]);
  equal(await outage.json(), { error: "Photo temporarily unavailable." });
  route.state.failLookup = false;
  route.state.failMedia = true;
  const upstream = await route.get("pizza");
  equal([upstream.status, cacheControl(upstream)], [503, NO_STORE]);
  ok(!JSON.stringify(await upstream.json()).includes("exploded"), "an unexpected failure leaks no detail");

  const production = photoRoute({ seeds: false, restaurants: { pizza: { id: "pizza" } } });
  await production.get("pizza");
  equal(production.calls.lookups, [["pizza", { includeSeeds: false }]]);
}

// A shared cache in front of the routes stores what the response headers allow.
function sharedCache(handler) {
  const stored = new Map();
  return async (id) => {
    if (stored.has(id)) return stored.get(id).clone();
    const response = await handler(id);
    if (!(cacheControl(response) ?? "").includes(NO_STORE)) stored.set(id, response.clone());
    return response;
  };
}
{
  const route = photoRoute({ restaurants: { pizza: { id: "pizza" } } });
  const cached = sharedCache(route.get);
  equal((await cached("pizza")).status, 200);
  delete route.state.restaurants.pizza;                       // unpublished
  equal((await cached("pizza")).status, 404);
  route.state.restaurants.pizza = { id: "pizza" };            // published again
  equal((await cached("pizza")).status, 200);
  delete route.state.restaurants.pizza;
  equal((await cached("pizza")).status, 404);

  // Control: the same flow with the old, header-less 404 would have served a stale "not found".
  const missing = { id: "pizza" };
  const legacy = sharedCache(async (id) =>
    missing.id === id && !missing.hidden
      ? Response.json({ photo: null }, { headers: { "Cache-Control": NO_STORE } })
      : Response.json({ error: "Unknown restaurant." }, { status: 404 }));
  missing.hidden = true;
  equal((await legacy("pizza")).status, 404);
  missing.hidden = false;
  equal((await legacy("pizza")).status, 404);                 // stale: this is the bug the header prevents
}

function videosRoute({ restaurants = {}, failVideos = false } = {}) {
  const calls = { videos: [] };
  const route = load("app/api/restaurants/[id]/videos/route.ts", {
    "@/lib/db/restaurants": { getAppRestaurantById: async (id) => restaurants[id] ?? null },
    "@/lib/contentMode": { shouldIncludeSeedRestaurants: () => true },
    "@/lib/db/videos": {
      async getActiveVideos(id) {
        calls.videos.push(id);
        if (failVideos) throw new Error("video store down");
        return [{ id: "v1" }];
      },
    },
  }, { Response });
  return { calls, get: (id) => route.GET(new Request("https://example.test/"), { params: Promise.resolve({ id }) }) };
}
{
  const healthy = videosRoute({ restaurants: { pizza: { id: "pizza" } } });
  const ok200 = await healthy.get("pizza");
  equal([ok200.status, cacheControl(ok200), (await ok200.json()).videos.length], [200, NO_STORE, 1]);
  const missing = await healthy.get("hidden");
  equal([missing.status, cacheControl(missing)], [404, NO_STORE]);
  equal(healthy.calls.videos, ["pizza"]);                     // nothing is read for a restaurant that is not public
  const degraded = await videosRoute({ restaurants: { pizza: { id: "pizza" } }, failVideos: true }).get("pizza");
  equal([degraded.status, cacheControl(degraded)], [200, NO_STORE]);
  equal((await degraded.json()).videos, []);
}

// ---------------------------------------------------------------------------
// 2. Photo load rules.
// ---------------------------------------------------------------------------
const rules = load("lib/placePhotoLoad.ts");
const { initialPhotoLoad, photoLoadKey, reducePhotoLoad, selectPhotoLoad, PHOTO_PATIENCE_MS } = rules;
const A = photo("A");
const B = photo("B");
const keyA = photoLoadKey(A);
const keyB = photoLoadKey(B);
const step = (state, type, key) => reducePhotoLoad(state, { type, key });

equal(photoLoadKey(null), null);
ok(photoLoadKey(A) !== photoLoadKey(B), "different photos have different keys");
ok(photoLoadKey(A) !== photoLoadKey({ ...A, googleMapsUri: "https://maps.example/photo/other" }), "the individual source link is part of a photo's identity");
ok(PHOTO_PATIENCE_MS > 0 && PHOTO_PATIENCE_MS <= 5_000, "a slow photo gets a fallback within seconds");

{
  let state = initialPhotoLoad(keyA);
  equal(selectPhotoLoad(state, A), { attempted: A, displayed: null, showFallback: false });
  state = step(state, "slow", keyA);
  equal(selectPhotoLoad(state, A), { attempted: A, displayed: null, showFallback: true });
  state = step(state, "load", keyA);                       // a slow photo that finally arrives replaces the fallback
  equal(selectPhotoLoad(state, A), { attempted: A, displayed: A, showFallback: false });
  equal(step(state, "error", keyA), state);                // loaded is final
  equal(step(state, "slow", keyA), state);

  state = step(initialPhotoLoad(keyA), "error", keyA);
  equal(selectPhotoLoad(state, A), { attempted: null, displayed: null, showFallback: true });
  equal(step(state, "load", keyA), state);                 // a failed photo stays failed
  equal(selectPhotoLoad(initialPhotoLoad(null), null), { attempted: null, displayed: null, showFallback: true });
  equal(selectPhotoLoad(initialPhotoLoad(null), undefined), { attempted: null, displayed: null, showFallback: true });
  // There is nothing to answer for when there is no photo.
  for (const type of ["load", "error", "slow"]) equal(step(initialPhotoLoad(null), type, null), initialPhotoLoad(null));
}
{
  // Late answers about an earlier restaurant's photo.
  const state = initialPhotoLoad(keyB);
  equal(step(state, "load", keyA), state);
  equal(step(state, "error", keyA), state);
  equal(step(state, "slow", keyA), state);
  equal(selectPhotoLoad(step(state, "load", keyA), B), { attempted: B, displayed: null, showFallback: false });
  // A state can never be paired with a different photo, so a credit cannot follow the wrong image.
  const loadedA = step(initialPhotoLoad(keyA), "load", keyA);
  equal(selectPhotoLoad(loadedA, B), { attempted: null, displayed: null, showFallback: true });
  equal(reducePhotoLoad(loadedA, { type: "reset", key: keyB }), initialPhotoLoad(keyB));
  equal(reducePhotoLoad(loadedA, { type: "reset", key: keyA }), loadedA);
}

// ---------------------------------------------------------------------------
// 3. The hook, driven by a minimal React model.
// ---------------------------------------------------------------------------
function hookHarness() {
  const clock = createClock();
  const slots = [];
  let index = 0;
  let rendering = false;
  let dirty = false;
  let effects = [];
  let args = [];
  let current;
  const react = {
    useReducer(reducer, arg, init) {
      const slot = (slots[index] ??= { state: init ? init(arg) : arg });
      index++;
      slot.reducer = reducer;
      return [slot.state, (action) => {
        slot.state = slot.reducer(slot.state, action);
        if (rendering) dirty = true;
        else render(...args);
      }];
    },
    useEffect(effect, deps) {
      const slot = (slots[index] ??= {});
      index++;
      if (slot.deps && deps && deps.every((dep, i) => Object.is(dep, slot.deps[i]))) return;
      effects.push(() => {
        slot.cleanup?.();
        slot.deps = deps;
        slot.cleanup = effect() ?? undefined;
      });
    },
  };
  const { usePlacePhotoImage: runHook } = load("lib/usePlacePhotoImage.ts", { react, "./placePhotoLoad": rules }, {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  function render(...next) {
    args = next;
    rendering = true;
    let passes = 0;
    do {
      dirty = false;
      index = 0;
      effects = [];
      current = runHook(...args);
      assert(++passes < 20, "render loop");
    } while (dirty);
    rendering = false;
    const run = effects;
    effects = [];
    run.forEach((effect) => effect());
    return current;
  }
  return { clock, render, latest: () => current, unmount: () => slots.forEach((slot) => slot.cleanup?.()) };
}
const view = (hook) => {
  const { photo: attempted, displayed, showFallback, phase, imageProps } = hook.latest();
  return { attempted, displayed, showFallback, phase, visibility: imageProps.style.visibility };
};

{
  // Slow: the fallback appears after the patience period and the photo can still win.
  const hook = hookHarness();
  hook.render(A);
  equal(view(hook), { attempted: A, displayed: null, showFallback: false, phase: "loading", visibility: "hidden" });
  equal(hook.clock.pending(), 1);
  hook.clock.advance(PHOTO_PATIENCE_MS - 1);
  equal(view(hook).phase, "loading");
  hook.clock.advance(1);
  equal(view(hook), { attempted: A, displayed: null, showFallback: true, phase: "slow", visibility: "hidden" });
  equal(hook.clock.pending(), 0);
  hook.latest().imageProps.onLoad();
  equal(view(hook), { attempted: A, displayed: A, showFallback: false, phase: "loaded", visibility: "visible" });
  hook.unmount();
}
{
  // Never completes: the fallback stays for as long as it takes, never a blank area.
  const hook = hookHarness();
  hook.render(A);
  hook.clock.advance(PHOTO_PATIENCE_MS);
  hook.clock.advance(10 * 60_000);
  equal(view(hook), { attempted: A, displayed: null, showFallback: true, phase: "slow", visibility: "hidden" });
  equal(hook.clock.pending(), 0);
  hook.unmount();
}
{
  // Fails quickly: fallback straight away, no credit, no timer left running.
  const hook = hookHarness();
  hook.render(A);
  hook.latest().imageProps.onError();
  equal(view(hook), { attempted: null, displayed: null, showFallback: true, phase: "failed", visibility: "hidden" });
  equal(hook.clock.pending(), 0);
  hook.latest().imageProps.onLoad();                           // a late answer from the image that failed
  equal(view(hook), { attempted: null, displayed: null, showFallback: true, phase: "failed", visibility: "hidden" });
  hook.unmount();
}
{
  // The restaurant changes while the first photo is still on its way.
  const hook = hookHarness();
  hook.render(A);
  const staleHandlers = hook.latest().imageProps;
  hook.clock.advance(PHOTO_PATIENCE_MS - 500);
  hook.render(B);
  equal(view(hook), { attempted: B, displayed: null, showFallback: false, phase: "loading", visibility: "hidden" });
  equal(hook.clock.pending(), 1);                              // only the new photo's timer is running
  staleHandlers.onLoad();                                      // A's image answers late
  equal(view(hook), { attempted: B, displayed: null, showFallback: false, phase: "loading", visibility: "hidden" });
  staleHandlers.onError();
  equal(view(hook).attempted, B);
  hook.clock.advance(499);                                     // A's old timer would have fired by now
  equal(view(hook).phase, "loading");
  hook.clock.advance(1_501);
  equal(view(hook).phase, "slow");
  hook.latest().imageProps.onLoad();
  equal(view(hook).displayed, B);
  hook.unmount();
}
{
  // Navigating away after a photo has loaded never carries its credit to the next restaurant.
  const hook = hookHarness();
  hook.render(A);
  hook.latest().imageProps.onLoad();
  equal(view(hook).displayed, A);
  const lateFromA = hook.latest().imageProps;
  hook.render(B);
  equal(view(hook).displayed, null);
  lateFromA.onLoad();
  equal(view(hook).displayed, null);
  hook.render(null);                                           // a restaurant without a photo
  equal(view(hook), { attempted: null, displayed: null, showFallback: true, phase: "loading", visibility: "hidden" });
  hook.render({ ...A, googleMapsUri: "https://maps.example/photo/elsewhere" });
  equal(view(hook).displayed, null);                           // same image address, different source: not yet shown
  hook.unmount();
}

// Credit consistency under any order of renders, answers and delays.
{
  let seed = 12345;
  const random = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const photos = [A, B, photo("C"), null, undefined, { ...A, googleMapsUri: "https://maps.example/photo/A2" }];
  const hook = hookHarness();
  let input = photos[0];
  let handlers = [];
  hook.render(input);
  for (let i = 0; i < 600; i++) {
    const action = random(6);
    if (action === 0) {
      input = photos[random(photos.length)];
      hook.render(input);
    } else if (action === 1) hook.latest().imageProps.onLoad();
    else if (action === 2) hook.latest().imageProps.onError();
    else if (action === 3 && handlers.length) handlers[random(handlers.length)][random(2) ? "onLoad" : "onError"]();
    else if (action === 4) hook.clock.advance(random(3_000));
    else hook.render(input);
    handlers.push(hook.latest().imageProps);
    handlers = handlers.slice(-8);
    const { displayed, photo: attempted, showFallback, phase } = hook.latest();
    if (displayed) {
      ok(displayed === input && phase === "loaded", "a credit is only ever for the photo being shown");
      ok(!showFallback, "a displayed photo has no fallback over it");
    }
    ok(attempted === null || attempted === input, "an old restaurant's photo is never kept");
    ok(displayed !== null || phase !== "loaded" || input === null || input === undefined, "loaded implies displayed");
    ok(showFallback || displayed !== null || phase === "loading", "never a blank area once loading has taken too long");
  }
  hook.unmount();
}

// ---------------------------------------------------------------------------
// 4. Credits are only ever rendered for the image that is actually displayed.
// ---------------------------------------------------------------------------
for (const file of ["components/RestaurantHero.tsx", "components/editorial/SavedRestaurantItem.tsx", "components/AdminCandidates.tsx"]) {
  const source = readFileSync(root(file), "utf8");
  const uses = [...source.matchAll(/<PlacePhotoAttribution\s+photo=\{([^}]+)\}/g)].map((match) => match[1].trim());
  ok(uses.length >= 1, `${file} renders credits`);
  ok(uses.every((expression) => expression === "image.displayed"), `${file} passes only the displayed photo: ${uses}`);
}

console.log(`Photo reliability checks passed (${checks} assertions; no network, database or browser).`);
