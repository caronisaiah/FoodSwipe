# Map v2 return state (contract for P14-C)

Map v2 saves a small snapshot just before it navigates to a restaurant profile, and restores it once when the
Map is shown again. P14-C (Profile v2) must keep the Back path compatible with this contract.

## What is saved

`lib/mapReturnState.ts`, key `foodswipe.map-return.v1` in **this tab's `sessionStorage`**:

| Field | Meaning |
| --- | --- |
| `market` | Effective discovery market. Applied only if it equals the Map's current market. |
| `center`, `zoom` | Map camera. Longitude -180..180, latitude -90..90, zoom 0..22. |
| `selected` | Slug of the open preview, or `null`. Applied only if it is still an approved location. |
| `filter` | `"all"` or `"saved"`. |
| `listScroll` | Scroll position of the restaurant index (0..1,000,000). |
| `focus` | `"profile"` (the View profile link), `"marker"` or `"index"`. |
| `savedAt` | Epoch ms. Snapshots older than 30 minutes are ignored. |

## Rules

- It is **written** only when View profile is activated from a preview (`rememberForReturn`).
- It is **read and removed** once when the Map loads (`takeMapReturnState`). A snapshot for another market,
  a malformed one, an expired one or an unreadable one is discarded and the Map opens on its normal first view.
- It holds **no URLs**. The Back destination is the Map route itself, so there is nothing to steer to an
  arbitrary address. Any "return to" value P14-C adds must stay a bounded enum or a canonical in-app route.
- Storage can be blocked: every read and write is wrapped, and failure only means the normal first view.
- Restore order matters: the preview takes its space first, then the camera is applied, so the same part of the
  map is on screen. Focus goes to the View profile link when `focus` is `"profile"`.

## What P14-C must preserve

1. Keep `/restaurants/[slug]` as the canonical profile route that Map links to; Map does not create a second one.
2. Do not clear `foodswipe.map-return.v1` from the profile page, and do not read it there. Browser Back to the Map
   route is enough; the Map reads it.
3. If P14-C adds an in-profile Back button, send it to the Map route with the browser history (`router.back()`)
   when the previous entry is the Map, otherwise to `/map` (or `/saved`, `/feed`). It must not accept a URL.
4. Saved → profile → Back is a different return (Saved has its own scroll and invoking control) and is not part of
   this snapshot.

## Update (Profile v2)

Implemented in the standalone profile (`components/RestaurantProfile.tsx`).

- **Entry points name themselves** with a bounded `?from=map|saved|feed` on the canonical link
  (`/restaurants/[slug]?from=map`). `lib/profileOrigin.ts` accepts only those three words; anything else, including a
  URL, is ignored. Share links never include it.
- **The snapshot is armed by a return.** It gains `armed: boolean` (saved as `false` when View profile is used). The profile
  arms it, bound to its own slug, when the person goes Back: its Back button, or a browser back/forward traversal
  (Navigation API `traverse`, plus `popstate` for browsers without it). The Map restores only an armed snapshot and always
  removes it, so a profile left some other way (a nav tab, a typed URL) can never hijack a later Map visit.
- **Back button:** with a `from` and a history entry it uses browser history; otherwise it goes to the origin's route
  (`/map`, `/saved`, `/feed`). A direct link has no `from` and shows "Back to Swipe" (`/feed`).
- **Saved** needs nothing beyond history: Back lands on `/saved`, which loads its own list.
