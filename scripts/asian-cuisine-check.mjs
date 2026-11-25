// Tune's grouped Asian cuisine choice: membership, ranking, exclusivity, persistence and market changes.
// Runs the app's real TypeScript in a vm sandbox — no browser, network or database.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSandbox } from "./lib/ts-sandbox.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`FAIL - ${name}`); throw error; }
}

// Values built inside the vm context are a different realm, so compare their JSON form.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

const plain = createSandbox({ root });
const groups = plain.load("lib/cuisineGroups.ts");
const { scoreRestaurant } = plain.load("lib/recommendations.ts");
const { CRAVING_OPTIONS } = plain.load("lib/options.ts");
const { RESTAURANTS } = plain.load("lib/seed/restaurants.ts");

const BASE = { location: "Washington, DC", maxDistanceMiles: 5, budget: 3, cravings: [], broadCuisines: [], vibes: [], dietary: [] };
const prefs = (over) => ({ ...BASE, ...over });
const place = (tags) => ({ ...RESTAURANTS[0], cuisineTags: tags });
// Craving points only: the score delta against no cravings (rounded to absorb float noise).
const craving = (restaurant, p) => Math.round((scoreRestaurant(restaurant, p).score - scoreRestaurant(restaurant, BASE).score) * 1e6) / 1e6;
const reasons = (restaurant, p) => scoreRestaurant(restaurant, p).matchReasons.filter((reason) => reason.startsWith("Matches your craving"));

// --- Membership ------------------------------------------------------------------------------------
check("members are exactly the canonically supported Asian choices", () => {
  same([...groups.ASIAN_CHOICES].sort(),
    ["chinese", "dim sum", "filipino", "indian", "japanese", "korean", "ramen", "sushi", "thai", "vietnamese"]);
  const offered = new Set(CRAVING_OPTIONS.map((option) => option.value));
  for (const value of groups.ASIAN_CHOICES) assert(offered.has(value), `${value} must be a real Tune choice`);
});
check("generic or format tags are not Asian", () => {
  for (const tag of ["noodles", "street food", "omakase", "seafood", "american", "mexican", "pizza"]) {
    assert.equal(groups.hasAsianTag([tag]), false, tag);
    assert.equal(groups.isAsianChoice(tag), false, tag);
  }
});

// --- Ranking ---------------------------------------------------------------------------------------
check("any canonical member, the literal asian tag, or laotian matches All Asian once", () => {
  const all = prefs({ broadCuisines: ["asian"] });
  for (const tag of [...groups.ASIAN_CHOICES, "asian", "laotian"]) assert.equal(craving(place([tag]), all), 28, tag);
});
check("a noodles-only (or street-food-only) place gets nothing from All Asian", () => {
  const all = prefs({ broadCuisines: ["asian"] });
  assert.equal(craving(place(["noodles"]), all), 0);
  assert.equal(craving(place(["noodles", "street food"]), all), 0);
  same(reasons(place(["noodles"]), all), []);
});
check("many Asian tags on one place still score one broad match", () => {
  const all = prefs({ broadCuisines: ["asian"] });
  assert.equal(craving(place(["japanese", "sushi", "ramen", "asian", "omakase"]), all), 28);
  same(reasons(place(["japanese", "sushi", "asian"]), all), ["Matches your craving for Asian"]);
});
check("specific choices keep per-tag scoring", () => {
  const p = place(["japanese", "sushi", "ramen", "asian"]);
  assert.equal(craving(p, prefs({ cravings: ["sushi"] })), 28);
  assert.equal(craving(p, prefs({ cravings: ["sushi", "ramen"] })), 56);
  assert.equal(craving(p, prefs({ cravings: ["thai"] })), 0);
});
check("stored broad + specific Asian together never double-score", () => {
  const p = place(["thai", "asian"]);
  assert.equal(craving(p, prefs({ broadCuisines: ["asian"], cravings: ["thai", "sushi"] })), 28);
});
check("broad Asian leaves non-Asian cravings alone", () => {
  const burger = place(["burgers", "american"]);
  assert.equal(craving(burger, prefs({ broadCuisines: ["asian"] })), 0);
  assert.equal(craving(burger, prefs({ broadCuisines: ["asian"], cravings: ["burgers"] })), 28);
  assert.equal(craving(place(["thai", "burgers"]), prefs({ broadCuisines: ["asian"], cravings: ["burgers"] })), 56);
});
check("with no broad intent every seeded place scores exactly as before", () => {
  const before = (r, cravings) => cravings.filter((c) => r.cuisineTags.includes(c)).length * 28;
  for (const cravings of [[], ["burgers"], ["thai", "sushi"], ["noodles"], ["pizza", "ramen", "korean"]]) {
    for (const r of RESTAURANTS) assert.equal(craving(r, prefs({ cravings })), before(r, cravings), `${r.id} ${cravings}`);
  }
});

// --- Grouping from the active market ---------------------------------------------------------------
const option = (value) => CRAVING_OPTIONS.find((o) => o.value === value);
const market = (...values) => values.map(option);
const slots = (options, opts) => groups.groupAsianOptions(options, opts).rows.map((row) => "group" in row ? "ASIAN" : row.option.value);

check("the group takes the first member's slot and every other row keeps its order", () => {
  const options = market("american", "burgers", "thai", "pizza", "chinese", "mexican", "noodles", "korean", "seafood");
  same(slots(options), ["american", "burgers", "ASIAN", "pizza", "mexican", "noodles", "seafood"]);
  same(groups.groupAsianOptions(options).members.map((m) => m.value), ["thai", "chinese", "korean"]);
});
check("children are only what the market carries, never noodles or invented tags", () => {
  const { members } = groups.groupAsianOptions(market("thai", "ramen", "noodles", "burgers", "dim sum"));
  same(members.map((m) => m.value), ["thai", "ramen", "dim sum"]);
});
check("one or zero members and no Asian intent: no group, ordinary rows (NYC-sized markets unaffected)", () => {
  same(slots(market("burgers", "thai", "pizza")), ["burgers", "thai", "pizza"]);
  same(slots(market("burgers", "pizza")), ["burgers", "pizza"]);
  // A lone member that is itself selected is still an ordinary row, not a disclosure.
  same(slots(market("burgers", "thai", "pizza"), { selected: ["thai"] }), ["burgers", "thai", "pizza"]);
});
check("two or more members always group, with or without intent", () => {
  same(slots(market("burgers", "thai", "korean"), { broadOnly: true }), ["burgers", "ASIAN"]);
  same(slots(market("burgers", "thai", "korean"), { allAsian: true }), ["burgers", "ASIAN"]);
});
check("one member plus a broad-only tag (asian/laotian) offers All Asian", () => {
  const out = groups.groupAsianOptions(market("burgers", "thai", "pizza"), { broadOnly: true });
  same(out.rows.map((r) => "group" in r ? "ASIAN" : r.option.value), ["burgers", "ASIAN", "pizza"]);
  assert.equal(out.canChooseAll, true);
  assert.equal(groups.groupAsianOptions(market("burgers", "pizza"), { broadOnly: false }).canChooseAll, false);
  assert.equal(groups.groupAsianOptions(market("burgers", "pizza"), { broadOnly: true }).canChooseAll, true);
  assert.equal(groups.hasBroadOnlyAsianTag(["laotian", "street food"]), true);
  assert.equal(groups.hasBroadOnlyAsianTag(["asian"]), true);
  assert.equal(groups.hasBroadOnlyAsianTag(["thai", "noodles"]), false);
});
check("stored All Asian keeps the row visible with 1 or 0 members, in place (last when no member)", () => {
  same(slots(market("burgers", "thai", "pizza"), { allAsian: true }), ["burgers", "ASIAN", "pizza"]);
  same(slots(market("burgers", "pizza"), { allAsian: true }), ["burgers", "pizza", "ASIAN"]);
  assert.equal(groups.groupAsianOptions(market("burgers", "pizza"), { allAsian: true }).canChooseAll, false);
});
check("selected specifics the market lacks keep the row visible with 1 or 0 members", () => {
  same(slots(market("burgers", "korean", "pizza"), { selected: ["thai"] }), ["burgers", "ASIAN", "pizza"]);
  same(slots(market("burgers", "pizza"), { selected: ["thai", "sushi"] }), ["burgers", "pizza", "ASIAN"]);
  // ...and clearing them drops the row again (nothing hidden is left active).
  same(slots(market("burgers", "pizza"), { selected: [] }), ["burgers", "pizza"]);
});
check("non-Asian rows keep their order whenever the group is added", () => {
  const options = market("american", "burgers", "pizza", "mexican", "seafood");
  same(slots(options, { allAsian: true }).filter((s) => s !== "ASIAN"), ["american", "burgers", "pizza", "mexican", "seafood"]);
});
check("a market change surfaces selected specifics the new market lacks", () => {
  const dc = groups.groupAsianOptions(market("thai", "chinese", "korean", "burgers")).members;
  const small = groups.groupAsianOptions(market("korean", "japanese", "burgers")).members;
  same(groups.unavailableAsianChoices(["thai", "korean", "burgers"], dc), []);
  same(groups.unavailableAsianChoices(["thai", "korean", "burgers"], small), ["thai"]);
});

// --- Exclusivity -----------------------------------------------------------------------------------
check("All Asian replaces the specific Asian picks and keeps everything else", () => {
  const next = groups.setAllAsian(prefs({ cravings: ["thai", "burgers", "sushi"], vibes: ["casual"] }), true);
  same(next.cravings, ["burgers"]);
  same(next.broadCuisines, ["asian"]);
  same(next.vibes, ["casual"]);
});
check("picking a specific ends All Asian; clearing a specific does not", () => {
  const broad = prefs({ broadCuisines: ["asian"], cravings: ["burgers"] });
  const picked = groups.setAsianChoice(broad, "thai", true);
  same(picked.broadCuisines, []);
  same(picked.cravings, ["burgers", "thai"]);
  same(groups.setAsianChoice(broad, "thai", false).broadCuisines, ["asian"]);
});
check("turning All Asian off selects nothing and loses nothing else", () => {
  const next = groups.setAllAsian(prefs({ broadCuisines: ["asian"], cravings: ["burgers"] }), false);
  same(next.broadCuisines, []);
  same(next.cravings, ["burgers"]);
});
check("choosing a specific keeps other specifics, including ones this market lacks", () => {
  const next = groups.setAsianChoice(prefs({ cravings: ["thai"] }), "korean", true);
  same(next.cravings, ["thai", "korean"]);
  same(groups.setAsianChoice(next, "thai", false).cravings, ["korean"]);
});

// --- Persistence, migration, reload, reset ---------------------------------------------------------
function browser(store = new Map()) {
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const window = { localStorage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  const react = { useCallback: (fn) => fn, useMemo: (fn) => fn(), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const sandbox = createSandbox({
    root,
    globals: { window, CustomEvent: class {} },
    overrides: { react, "./discoveryState": {}, "./discoveryStorage": {} },
  });
  return { store, ...sandbox.load("lib/storage.ts") };
}
const KEY = "foodswipe.preferences.v1";

check("a record saved before this field existed reads as no broad choice, losing nothing", () => {
  const legacy = { location: "Brooklyn", maxDistanceMiles: 3, budget: 2, cravings: ["thai", "burgers"], vibes: ["casual"], dietary: ["halal"] };
  const read = browser().normalizePreferences(legacy);
  same(read.broadCuisines, []);
  same({ ...read, broadCuisines: undefined }, { ...legacy, broadCuisines: undefined });
  const app = browser(new Map([[KEY, JSON.stringify(legacy)]]));
  same(app.usePreferences().preferences.cravings, ["thai", "burgers"]);
});
check("an inconsistent stored record (broad + specifics) resolves to the broad choice", () => {
  const { normalizePreferences } = browser();
  const read = normalizePreferences({ broadCuisines: ["asian"], cravings: ["thai", "burgers", "sushi"] });
  same(read.broadCuisines, ["asian"]);
  same(read.cravings, ["burgers"]);
  // Ranking agrees with the repaired record: one Asian match, burgers untouched.
  assert.equal(craving(place(["thai", "burgers"]), read), 56);
  const app = browser(new Map([[KEY, JSON.stringify({ broadCuisines: ["asian"], cravings: ["thai"] })]]));
  same(app.usePreferences().preferences.cravings, []);
});
check("a lone ordinary Asian checkbox toggles through the exclusive setter", () => {
  const broad = prefs({ broadCuisines: ["asian"], cravings: ["burgers"] });
  const picked = groups.setAsianChoice(broad, "thai", true);
  same(picked.broadCuisines, []);
  same(picked.cravings, ["burgers", "thai"]);
  same(groups.setAsianChoice(picked, "thai", false).cravings, ["burgers"]);
});
check("malformed broad values are dropped, valid ones de-duplicated", () => {
  const { normalizePreferences } = browser();
  same(normalizePreferences({ broadCuisines: ["asian", "asian", "italian", 5, null] }).broadCuisines, ["asian"]);
  same(normalizePreferences({ broadCuisines: "asian" }).broadCuisines, []);
  same(normalizePreferences(null).broadCuisines, []);
});
check("broad intent persists separately from cravings and survives reload", () => {
  const first = browser();
  const { setPreferences } = first.usePreferences();
  setPreferences((previous) => groups.setAllAsian({ ...previous, cravings: ["burgers", "thai"] }, true));
  const saved = JSON.parse(first.store.get(KEY));
  same(saved.broadCuisines, ["asian"]);
  same(saved.cravings, ["burgers"]);
  const reloaded = browser(first.store).usePreferences().preferences;
  same(reloaded.broadCuisines, ["asian"]);
  same(reloaded.cravings, ["burgers"]);
});
check("other Tune edits keep the broad choice", () => {
  const app = browser();
  const { setPreferences } = app.usePreferences();
  setPreferences((previous) => groups.setAllAsian(previous, true));
  setPreferences((previous) => ({ ...previous, budget: 1, vibes: ["casual"] }));
  const read = app.usePreferences().preferences;
  same(read.broadCuisines, ["asian"]);
  assert.equal(read.budget, 1);
});
check("reset clears the broad choice", () => {
  const app = browser();
  const { setPreferences } = app.usePreferences();
  setPreferences((previous) => groups.setAllAsian(previous, true));
  setPreferences(app.DEFAULT_PREFERENCES);
  same(app.usePreferences().preferences.broadCuisines, []);
  app.store.delete(KEY);
  same(app.usePreferences().preferences, app.DEFAULT_PREFERENCES);
});
check("a market change does not rewrite stored preferences", () => {
  const app = browser();
  const { setPreferences } = app.usePreferences();
  setPreferences((previous) => groups.setAsianChoice({ ...previous, broadCuisines: [] }, "thai", true));
  const before = app.store.get(KEY);
  groups.groupAsianOptions(market("korean", "japanese")); // deriving another market's options is read-only
  assert.equal(app.store.get(KEY), before);
});

console.log(`\n${passed} checks passed`);
