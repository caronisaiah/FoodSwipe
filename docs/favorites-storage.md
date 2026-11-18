# Favorites and discovery history

## Baseline

At shared-market commit `b8a6b5b`, `foodswipe.swipes.v2` is a localStorage
array of `{ restaurantId, direction, at }`. Either direction excludes the
slug from the deck. Right swipes also provide Saved, its ordering and nav
count. Profile Save writes a right swipe, unsave deletes that entry, and
Start Over clears the array. The legacy entries contain no market field.
Preferences and the discovery market already live in separate storage.

The public restaurant slug is the ID used in the deck, Saved lookup, profiles,
and video/photo routes. PostgreSQL enforces a global unique index on slugs.
Promotion reserves seed IDs, and the public read paths use consistent seed
precedence in content modes that show seeds. The same slug is one favorite
across markets. An unresolved slug remains saved and is reported as unavailable.

## Canonical state and migration

The browser's `foodswipe-discovery` IndexedDB database stores a versioned
record with separate favorite records and market discovery history. A single
transaction publishes the initial state. Later transactions update the
relevant collection, or both for a right swipe. IndexedDB serializes concurrent
writers. Tabs are notified over BroadcastChannel and refresh when they regain
visibility or return from browser history.

On the first successful transaction only, read the old array. Keep distinct
valid slugs from both directions as legacy seen IDs. For duplicate right
swipes choose the latest known timestamp. A missing or invalid timestamp stays
unknown. Ties use legacy input order, and undated saves appear after dated
saves. Ignore malformed entries and keep any usable records. Bad JSON yields
an empty migration. A storage access or transaction error does not mark
migration complete. The committed versioned record is the migration marker.
Keep the original localStorage value byte for byte. Once the record exists,
later writes by an older client are ignored by the IndexedDB client. Deleting
only IndexedDB while retaining localStorage also deletes the migration marker.
A subsequent load can import the retained legacy data again.

Favorites store the original UTC epoch milliseconds or `null` and a stable
ordering key. An Undo receipt names the specific removal. It restores the
original timestamp and order only while that removal is still current. A
subsequent save or removal in another tab invalidates the receipt.

Discovery stores seen slugs per market. Legacy seen slugs apply to each deck
until that market is restarted. Start Over resets only the active market.
Previously saved restaurants can reappear with their saved status intact.
Right-swiping one advances the deck without creating another favorite or
changing its timestamp. Passing one advances the deck and keeps the favorite.
Saving or unsaving from a profile or Saved changes favorites independently
of the deck.

## Rollback

A legacy build reads `foodswipe.swipes.v2` as its Saved list. Favorites added
after migration will be missing from that list, and favorites removed after
migration may appear again. Which entries appear also depends on changes made
in legacy tabs. The IndexedDB list and timestamps are preserved through the
rollback. On previously migrated browsers, actions taken in the legacy build
will not be imported when the IndexedDB client returns.

Roll forward with a targeted fix, or roll back to a build that still includes
the IndexedDB storage layer. If a legacy rollback is unavoidable, pause
swipe, restart, save, and removal actions where possible and communicate the
stale Saved list. Keep both stores intact and restore the IndexedDB client as
soon as possible. Copying records between stores during a rollback can
resurrect removals or overwrite valid saves.

## Saved v2 contract

- Import `useFavorites()` from `lib/storage.ts`. Its `favorites` are ordered
  most recent first and have `restaurantId: string` and `savedAt: number | null`.
  The first resolved favorite can be featured. The total count includes
  unavailable records. Use the persisted timestamp only when it is known.
- `status` is `loading`, `ready`, or `error`. `retry()` reloads device storage.
  Mutations are asynchronous and reject on storage error. Preserve the
  previous visible list or offer retry on failure.
- `saveFavorite(restaurantId)` resolves to whether a new save was created.
  `removeFavorite(restaurantId)` returns an opaque receipt or `null` if
  already absent. Pass that receipt to `undoRemoveFavorite(receipt)`.
  The result is `false` if a newer operation superseded the removal.
- Resolve slugs with `GET /api/restaurants/saved?id=…` in groups of at most 25.
  The response contains public `SavedRestaurant` card data. Join by ID and
  keep favorite order. A missing/unpublished result and a failed fetch are
  separate states. Link to `/restaurants/${encodeURIComponent(restaurantId)}`.
- UI Undo state is temporary and per page. Persisted favorites and timestamps
  are browser-local. The interface leaves an explicit boundary for future
  account syncing.
