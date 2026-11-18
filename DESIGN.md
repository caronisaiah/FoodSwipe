# FoodSwipe Design System v2

Modern Food Editorial is the approved working foundation. Tune is the first migrated surface. Saved, Swipe, Map, and profiles share the destination rail and keep their current content treatments until their own phases.

## Visual identity

FoodSwipe helps people find somewhere to eat, from a quick lunch to a special evening. Let local storefronts, restaurant photography, and creator reviews carry the character. Use warm paper for planning and browsing, forest ink for reading, and tomato for the primary action and important states. Keep Swipe immersive with a dark media canvas and a scrim sized for the title and controls. Pair expressive page and restaurant titles with practical controls and metadata.

## Tokens and type

Add v2 tokens in [the Tailwind v4 editorial theme](app/editorial.css). Use the semantic `--color-editorial-*` and `--font-editorial-*` roles in new styles. Keep existing theme roles in place until their consumers migrate.

| Role | Working value |
| --- | --- |
| Paper and inset surface | `#F8F1E5`, `#FFF9EF` |
| Primary and secondary reading ink | `#22382C`, `#4D5B50` |
| Decorative divider and control boundary | `#B5AC96`, `#6B7867` |
| Primary action, hover, and pressed | `#A33226`, `#952D23`, `#7F231B` with `#FFF8EE` text |
| Neutral hover and press | `#EFE7D7`, `#E8DFCE` |
| Selected surface and ink | `#E5EAD6`, `#263D2E` |
| Focus, error, and disabled | Focus `#9C3329`, error `#902D24`, disabled surface `#DED9CA` with `#625D52` text |
| Dark media surfaces | Canvas `#101A16`, controls `#21342A` |
| Dark media reading and focus | Primary `#FFF8E9`, muted `#CCD5C8`, focus `#F5E6B7` |

Use DM Serif Text regular for page titles, expressive section headings, and featured restaurant names. Use Source Sans 3 for dense venue rows, controls, labels, navigation, and metadata. Use page titles at 34–52 px on mobile and 44–66 px on desktop, sections at 28–32 px, featured venue titles at 28–42 px, and immersive titles at 36–68 px. Body text is 16 px, controls 15–16 px, dense venue titles 17 px, metadata 13 px, and credits 11 px. Set headings to wrap naturally. Reserve uppercase and tight tracking for places where they improve recognition.

## Geometry and layout

- Use Tailwind’s 4 px spacing base. Typical values are 4, 8, 12, 16, 20, 24, 32 and 48 px.
- Use 2 px media and checkbox corners and 3 px action corners. Single affordances such as Share may use a circle.
- Use 1 px rules to separate content and a stronger boundary where someone must perceive a control’s edge. Keep compact rows flat.
- At widths below 790 px, Tune is one reading column and navigation stays at the bottom with safe-area padding. At 320 px, the gutter is 16 px. Allow vertical scrolling when additional choices push the CTA down.
- At 790 px and above, Tune uses a masthead navigation row, a banner column and a recommendation column. Cap content at 1100 px. Allow section titles and controls to wrap under zoom.
- Swipe keeps the media stage as the primary surface. Place readable type over a scrim where it is needed. Use the existing deck’s sizing and gesture conventions when moving the editorial treatment to Swipe.

## Reusable patterns

| Pattern | Implement with |
| --- | --- |
| Editorial type and canvas | `editorial-canvas`, `editorial-wordmark`, `editorial-page-title`, `editorial-section-title`. Keep heading levels semantic. |
| Primary and secondary actions | `editorial-action` for the main action. Add `editorial-action-secondary` for a quieter action. Use a button for an operation and a link for a destination. |
| Icon buttons | `editorial-icon-button` and a native control with an accessible name. Keep the tap area at least 44 × 44 px. |
| Price and multi-select | [PreferenceControls](components/editorial/PreferenceControls.tsx). Use fieldset names, native single-select radio groups and independent checkboxes. Selection gets a fill and a check or inset bar. |
| City feature and market disclosure | [DiscoveryCity](components/editorial/DiscoveryCity.tsx). Stack the credited city crop above **Taste of the City**. Place the market row directly below. Use current market data and explicit unavailable states. |
| Navigation | [BottomNav](components/BottomNav.tsx) supplies the existing destination order and save count. Group Map with Discover. Tune places the rail in its desktop masthead. Existing routes keep the rail in their current shell slot. |
| Saved collection | Feature the verified latest save with a bounded photo, serif name, useful metadata, and profile link. Use compact 70 × 60 px thumbnails and readable sans titles for the remaining rows. Promote the next newest on removal and preserve order on Undo. |
| Feedback and errors | Keep keyboard focus visible and selected states distinguishable with a shape or mark. Put status text in a live region when results change asynchronously. Show a retry for a failed load. Distinguish a truly empty collection from a fetch failure. |

Navigation destinations remain Discover, Saved, and Tune. Map retains its existing Discover association and Swipe return path. Profiles retain their existing back, save, and share behavior. On later screen migrations, carry the desktop masthead pattern into the relevant layouts with per-route focus and media checks.

## Motion and accessibility

Use a 2 px keyboard outline on light surfaces and the media focus color over dark surfaces. Target at least 44 px for primary touch controls and navigation. Keep attribution reachable and legible. Keep hover and pressed states distinct, use native disabled semantics for actual buttons, and indicate errors with text.

Use 100 ms for press and surface feedback, 120 ms for a later editorial page handoff, and 150 ms for a disclosure. Use cubic Bézier `(.22, 1, .36, 1)` for eases out. Tune uses Framer Motion for the market panel entrance and CSS for control feedback. Under reduced motion, disclose immediately and remove transform animation. Preserve production Swipe thresholds, gesture physics, and profile scrolling during the first migration.

## Contracts for the engineering rollout

**Discovery market.** Tune displays the server’s effective `getDefaultPublicMarket()` result. Its options come from the same unqualified `GET /api/restaurants` used by the feed. The disclosure identifies the current market and unavailable alternatives. To enable switching, define one validated effective market across Tune, feed, Map, and a global Saved collection. Decide persistence and deep-link rules. Scope feed and map reads to that effective market, reject stale responses, and make loading and unavailable states explicit. The existing API’s `?market=` support alone does not propagate a selection.

**Preferences and distance.** Existing browser storage persists price, cuisine, and occasion immediately. Make updates against the current stored value to preserve legacy fields. Hide cuisine when fewer than two real catalogue categories match and exclude dietary-looking tags. Occasion choices match the effective catalogue. Existing legacy location, radius, and dietary values remain readable by the current ranker. A future migration must define what to retain and how to retire hidden values. Name the fixed origin in distance copy. Decide origin, radius, and ranking versus eligibility on Swipe before exposing a radius.

**Favorites.** Start Over currently clears the swipe history that also supplies favorites. Before redesigning Saved, separate favorites into independent records with stable ordering so Start Over clears discovery history only. Resolve favorite restaurant IDs across published markets and define unavailable venue handling. Preserve save order when restoring an item. Verify migration, retries, and existing favorites before enabling the featured most-recent save in production.

**Next step.** Tune v2 has visual approval. Coordinate shared market state and favorites persistence before shipping the Saved feature. [Engineering handoff](docs/tune-v2-engineering-handoff.md)

## Future market atmosphere

Keep one component system across markets. The city image is the first local layer. NYC can emphasize street-level food culture and urban editorial photography. Vancouver can draw from Pacific Northwest rain and water. A future California launch city can use a nostalgic 2016 coastal look. Use shared semantic tokens and measured atmospheric effects in a later phase. Test contrast, motion preferences, and mobile performance across markets.

City images and local fonts retain their notices. [Photo credits and licenses](public/notices/media/tune-city.md) · [DM Serif Text license](public/notices/fonts/dm-serif.txt) · [Source Sans 3 license](public/notices/fonts/source-sans-3.txt)
