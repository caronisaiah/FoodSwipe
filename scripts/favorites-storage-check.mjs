import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(relative, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  runInNewContext(outputText, {
    ...globals,
    exports: compiled.exports,
    require: (specifier) => {
      assert(Object.hasOwn(dependencies, specifier), 'Unexpected scope: ' + specifier);
      return dependencies[specifier];
    },
  }, { filename: relative });
  return compiled.exports;
}

const markets = load("../lib/markets.ts");
const domain = load("../lib/discoveryState.ts", { "./markets": markets });
const {
  migrateLegacySwipes, isDiscoveryState, selectFavorites, selectSeen,
  addFavorite, removeFavorite, undoFavorite, recordSwipe, restartMarket,
} = domain;

let checks = 0;
function equal(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  checks++;
}
const swipe = (restaurantId, direction, at) => ({ restaurantId, direction, at });
const favorite = (restaurantId, savedAt) => ({ restaurantId, savedAt });
for (const raw of [null, "", "bad JSON", "null", '{"partial":true}']) {
  const state = migrateLegacySwipes(raw);
  equal(isDiscoveryState(state), true);
  equal(selectFavorites(state), []);
  equal(selectSeen(state, "nyc"), []);
}

const legacy = [
  swipe("nyc-first", "right", 30),
  swipe("dc-first", "right", 30),
  swipe("nyc-pass", "left", 90),
  swipe("stale", "right"),
  swipe("nyc-first", "right", 10),
  swipe("dc-first", "left", 100),
  swipe("earlier", "right", 20),
  swipe("unknown-later", "right", "yesterday"),
  swipe("earlier", "right", -3),
  swipe("constructor", "right", 0),
  swipe("", "right", 400),
  swipe("bad-dir", "bogus", 500),
  { direction: "right", at: 16 },
  null,
];
const raw = JSON.stringify(legacy);
let state = migrateLegacySwipes(raw);
const original = [
  favorite("nyc-first", 30), favorite("dc-first", 30), favorite("earlier", 20), favorite("constructor", 0),
  favorite("stale", null), favorite("unknown-later", null),
];
equal(selectFavorites(state), original);
equal(migrateLegacySwipes(raw), JSON.parse(JSON.stringify(state)));
equal(selectSeen(state, "dc"), ["nyc-first", "dc-first", "nyc-pass", "stale", "earlier", "unknown-later", "constructor"]);
equal(isDiscoveryState(state), true);
equal(isDiscoveryState({ ...state, version: 2 }), false);
equal(isDiscoveryState({ ...state, favorites: [state.favorites[0], state.favorites[0]] }), false);
equal(isDiscoveryState({ ...state, history: { fake: { restarted: true, seenIds: [] } } }), false);

state = recordSwipe(state, "dc", "another-dc", "left", 40).state;
equal(selectFavorites(state), original);
state = restartMarket(state, "nyc").state;
equal(selectSeen(state, "nyc"), []);
equal(selectSeen(state, "dc").at(-1), "another-dc");
const replay = recordSwipe(state, "nyc", "nyc-first", "right", 70);
equal(replay.value, false);
equal(selectSeen(replay.state, "nyc"), ["nyc-first"]);
equal(selectFavorites(replay.state), original);
state = recordSwipe(replay.state, "nyc", "nyc-first", "left", 80).state;
equal(selectFavorites(state), original);

const removed = removeFavorite(state, "nyc-first");
equal(selectFavorites(removed.state), original.slice(1));
equal(selectSeen(removed.state, "nyc"), ["nyc-first"]);
const undone = undoFavorite(removed.state, removed.value);
equal(undone.value, true);
equal(selectFavorites(undone.state), original);
equal(undoFavorite(undone.state, removed.value).value, false);

const resaved = addFavorite(removed.state, "nyc-first", 99);
equal(selectFavorites(resaved.state)[0], favorite("nyc-first", 99));
const removedAgain = removeFavorite(resaved.state, "nyc-first");
equal(undoFavorite(removedAgain.state, removed.value).value, false);
equal(undoFavorite(removedAgain.state, removedAgain.value).value, true);
const addedFromProfile = addFavorite(undone.state, "profile-only", 30);
equal(selectSeen(addedFromProfile.state, "nyc"), ["nyc-first"]);
equal(selectFavorites(addedFromProfile.state).slice(0,3), [...original.slice(0,2), favorite("profile-only", 30)]);
equal(isDiscoveryState(JSON.parse(JSON.stringify(addedFromProfile.state))), true);

const large = migrateLegacySwipes(JSON.stringify(Array.from({ length: 1000 }, (_, i) =>
  swipe(`saved-${i}`, "right", i))));
equal(selectFavorites(large).length, 1000);
equal(selectFavorites(large)[0], favorite("saved-999", 999));
equal(isDiscoveryState(large), true);
// Exercise the real transaction callbacks across reopened module instances.
const persisted = { raw, record: undefined, reads: 0, blocked: true };
function openFixture() {
  const window = {
    localStorage: {
      getItem(key) {
        assert.equal(key, "foodswipe.swipes.v2");
        persisted.reads++;
        if (persisted.blocked) throw new Error("Legacy storage read blocked");
        return persisted.raw;
      },
    },
    indexedDB: {
      open() {
        const request = {
          result: {
            transaction() {
              let written, aborted = false;
              const transaction = {
                abort() {
                  aborted = true;
                  queueMicrotask(() => transaction.onabort());
                },
                objectStore: () => ({
                  get() {
                    const read = { result: structuredClone(persisted.record) };
                    queueMicrotask(() => {
                      read.onsuccess();
                      if (aborted) return;
                      if (written) persisted.record = written;
                      transaction.oncomplete();
                    });
                    return read;
                  },
                  put: (next) => { written = structuredClone(next); },
                }),
              };
              return transaction;
            },
          },
        };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    },
  };
  return load("../lib/discoveryStorage.ts", { "./discoveryState": domain }, { window });
}

const browser = openFixture();
await browser.refreshDiscovery();
equal(browser.getDiscoverySnapshot().status, "error");
equal(persisted.record ?? null, null);
persisted.blocked = false;
await browser.refreshDiscovery();
equal(browser.getDiscoverySnapshot().status, "ready");
equal(selectFavorites(persisted.record), original);
equal(persisted.raw, raw);
await browser.updateDiscovery((state) => removeFavorite(state, "nyc-first"));
equal(selectFavorites(persisted.record), original.slice(1));
persisted.raw = JSON.stringify([...legacy, swipe("nyc-first", "right", 999)]);
const reopened = openFixture();
await reopened.refreshDiscovery();
equal(selectFavorites(reopened.getDiscoverySnapshot().state), original.slice(1));
await reopened.refreshDiscovery();
equal(persisted.reads, 2);
await reopened.updateDiscovery((state) => restartMarket(state, "nyc"));
equal(selectFavorites(persisted.record), original.slice(1));
equal(selectSeen(persisted.record, "nyc"), []);
persisted.record = { version: 2 };
await reopened.refreshDiscovery();
equal(reopened.getDiscoverySnapshot().status, "error");
equal(persisted.record, { version: 2 });
equal(persisted.reads, 2);

console.log(`Favorites checks passed (${checks} assertions, isolated storage). Cross-tab behavior is covered in browser QA.`);
