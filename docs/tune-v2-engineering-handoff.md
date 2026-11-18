# Tune v2 engineering handoff

The approved Tune implementation and shared editorial foundation are on `design/foodswipe-v2-implementation`, based on FoodSwipe commit `965bc6f`. The UI work contains no database migrations.

## UI-owned surfaces

| Files | Integration guidance |
| --- | --- |
| [DESIGN.md](../DESIGN.md), [editorial.css](../app/editorial.css), and the import in [globals.css](../app/globals.css) | The Tailwind v4 `--color-editorial-*`, typography, spacing, corner, and motion roles define the approved paper, forest, and tomato foundation. Reuse its actions, focus styles, and layout rules. Keep other routes’ theme tokens available. |
| [DiscoveryCity.tsx](../components/editorial/DiscoveryCity.tsx) and [PreferenceControls.tsx](../components/editorial/PreferenceControls.tsx) | Preserve the city banner, image attribution, native market disclosure, price radios, and preference checkboxes. Retain the local fonts, city photos, and notices under `public/`. |
| [PreferenceOnboarding.tsx](../components/PreferenceOnboarding.tsx) and [app/page.tsx](../app/page.tsx) | Preserve the approved Tune layout, responsive behavior, load states, and Explore restaurants action. Coordinate changes to the server market prop and catalogue request at this seam. |
| [BottomNav.tsx](../components/BottomNav.tsx) | Keep destination semantics, save counts, and the Discover association for Map. Tune uses a desktop masthead and mobile bottom rail. Swipe, Saved, Map, and profiles use their existing shell slots. |

## Current market and preference behavior

- Tune reads `getDefaultPublicMarket()` at request time. This uses `FOODSWIPE_DEFAULT_MARKET`, defaults to DC when unset, and returns an unavailable state for invalid configuration. Tune requests the same unqualified `GET /api/restaurants` as the feed and derives cuisine and occasion choices from rows matching the reported market.
- The alternative market is intentionally unavailable until shared market selection works. Enable it only after Tune, Swipe, and Map use a single validated effective market across navigation and reload. Scope catalogue and map reads to that market, handle stale responses, and keep favorites accessible across markets. The catalogue API already accepts a market query, but UI selection needs the shared contract.
- `usePreferences()` writes edits to budget, cravings, and vibes immediately in `foodswipe.preferences.v1`. Updates merge with the current stored record, preserving legacy location, radius, and dietary values. Explore restaurants navigates to `/feed`. The existing ranking logic still consumes the stored preferences.

## Incomplete behavior and required tests

- **Start Over can still affect favorites.** Swipes and favorites currently share history, which Start Over clears. Separate them before rolling out Saved changes. Test value migration, reset preserving favorites, and save and removal across reloads and routes.
- **Cross-market saved-item resolution still needs engineering work.** Saved currently looks up saved IDs against the default catalogue. Resolve favorites by stable restaurant ID across markets. Test an out-of-market favorite and a restaurant that has become unavailable.
- **Shared market selection.** Test configured and invalid defaults, switching between both markets, navigation and reload, and racing requests. Confirm that Tune’s label and choices, Swipe’s catalogue, and Map’s pins agree, including empty and failed catalogue responses.
- **Release regression.** Rerun ESLint, TypeScript, the production build, `scripts/public-market-check.mjs`, and `scripts/restaurant-import-check.mjs`. Recheck Tune’s mobile and desktop layouts, 200% text, keyboard and touch, reduced motion, retry focus, and preference persistence. Verify Swipe gestures and profile scrolling, Saved status, and both available and unavailable Map states. Live Mapbox, physical devices, and screen readers still need rollout coverage.
