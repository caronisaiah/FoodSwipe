# M3 Overture Places and Mapbox

The production public API returned ten published NYC profiles, each with two active real-source videos. Direct production database credentials were unavailable locally. The public API identifies profiles by slug. The location table references the existing internal restaurant primary key, and the staging import resolves that key from the slug and market. The map projects only reviewed location fields, the profile slug, and a count of active creator posts validated using the profile video rules. Existing restaurant IDs, slugs, browser saves, hero selections, and slug-based video attachments require no changes.

## NYC match review

The [location approval review](nyc-map-location-review.md) records subsequent checks against City address points and footprints, and identifies which points are ready for staging.

Official Overture Places release [2026-10-21.0](https://docs.overturemaps.org/blog/2026/10/21/release-notes/), schema v2.0.0, queried through DuckDB from the official S3 GeoParquet. The [structured report](overture-nyc-matches.json) preserves the exact point, feature version, raw address, and complete property-level source records. Coordinates below are latitude, longitude in WGS 84 and rounded for reading. The official addresses identify the branches. They do not independently survey the exact coordinates.

| Profile and independent identity evidence | Overture ID | Point (lat, lng) | Review |
| --- | --- | --- | --- |
| [Milk Burger](https://milkburger.com/order/), 148 Bruckner Blvd | `29acb38a-fec7-47df-82a2-c0aaa2b622dc` | 40.80359455, −73.92005431 | Pending. Excluded the closed East Harlem location. |
| [Emily](https://www.pizzalovesemily.com/location/brooklyn/), 919 Fulton St | `cb43a0e6-0935-4f90-81b9-4400c6d82523` | 40.68349896, −73.96644339 | Pending. Excluded West Village and the unrelated Upper West Side hit. |
| [Moonburger](https://www.moonburger.com/nolita), 72 Kenmare St | `10f3b427-394d-451d-92f7-ced3b5b0c7b8` | 40.72095400, −73.99629600 | Pending. Overture has no operating status and confidence is 0.77. The operator lists this branch. Foursquare source. |
| [Deux Luxe](https://www.deuxluxeny.com/), 384 Broome St | `51606d62-0432-4f75-aeb8-3ff5ce4cdfc5` | 40.72057510, −73.99653017 | Pending. Same street address. |
| [Smacking Burger](https://smackingburger.com/), 51–63 8th Ave | — | — | Missing. A separate search around the West Village found a gas-station record at the address and an unrelated listing. Neither establishes a Smacking Burger point. |
| [Au Cheval](https://www.auchevaldiner.com/nyc/about), 33 Cortlandt Alley | `7824f725-6dfc-45a8-9a22-7319083c9229` | 40.71809497, −74.00174975 | Pending. Same alley address. |
| [Gotham Burger Social Club](https://www.gbsc.nyc/location/lower-east-side/), 131 Essex St | `350e4ab4-6c06-4a9c-93a8-2217568b6f52` | 40.72003623, −73.98753669 | Pending. Lower East Side flagship. |
| [Minetta Tavern](https://www.minettatavernny.com/hours-and-location), 113 MacDougal St | `54ab7e35-3ad2-4ec6-91b0-a8c91f5ed307` | 40.73000953, −74.00064852 | Pending. Excluded a same-name hit on West 113th St. |
| [7th Street Burger East Village](https://merch.7thstreetburger.com/pages/locations), 91 E 7th St | `17ece59a-640c-4919-b6da-e94cfbe67160` | 40.72689329, −73.98537317 | Pending. Excluded other branches. |
| [4 Charles Prime Rib](https://www.nycprimerib.com/about), 4 Charles St | `f8b989d2-b102-4cb1-af01-7b5850fdd118` | 40.73514495, −74.00066078 | Pending. West Village branch. |

Eight candidates are sourced from Meta under CDLA Permissive 2.0. Moonburger is sourced from Foursquare under Apache 2.0. Overture’s enrichment entries carry their own source data and labels in the report. Preserve the Overture link, per-provider credits, and [Foursquare NOTICE and Apache license](../public/notices/overture-places.txt) when redistributing the extract. The map keeps Mapbox’s own logo and attribution controls; the Overture overlays are separate from Mapbox’s basemap. [Overture attribution](https://docs.overturemaps.org/attribution/#places) · [Mapbox attribution](https://docs.mapbox.com/help/dive-deeper/attribution/)

## Prepare local staging

1. Use Python with DuckDB 2.0.0 and run `python scripts/overture-nyc.py --report /tmp/overture-review.json --staging-sql /tmp/overture-pending.sql`. It reads the pinned public release and writes files. If several records match, it reports all and emits no insert for that venue.
2. Apply the additive migration to a disposable local PostgreSQL database named `foodswipe_map_staging` with a fixture or authorized copy of the restaurant inventory. Run `psql -X -h localhost -d foodswipe_map_staging -f /tmp/overture-pending.sql`. The transaction checks the database name and server address, inserts pending records only for existing published NYC slugs, and leaves prior decisions intact on retry. The application reads the staging database through a compatible Neon HTTP endpoint for integrated staging QA.
3. Review the identity evidence, geometry, and license for every candidate. Set `display_name`, optional independently verified area/address, and optional independently curated cuisine with its evidence URL. In a separate human review, set `status` to approved or rejected and record `reviewed_at`, `reviewed_by`, and a note. The table enforces one approved point per profile and one approved profile per Overture ID. Unmatched venues stay off the map. If an existing location needs replacing, retire it and approve the replacement in one transaction.

## Mapbox setup and cost

Create a dedicated Mapbox public `pk.` token in the Mapbox console with `styles:read` and `fonts:read`. Restrict the development token to the exact localhost port or a named HTTPS test origin. Mapbox URL restrictions do not support IP addresses, so use a named HTTPS test origin for physical phones. Use a separate token restricted to the eventual production hostname. Set `MAPBOX_PUBLIC_TOKEN` and `FOODSWIPE_DEFAULT_MARKET=nyc`. Enable `FOODSWIPE_MAP_ENABLED=true` in the isolated QA environment after review. Production should leave the flag unset through real-token and device QA. [Mapbox tokens](https://docs.mapbox.com/accounts/guides/tokens/)

The browser loads Mapbox GL JS 3.35.0 and its stylesheet from the pinned official CDN only on an enabled map with approved pins. The map makes no Places, geocoding, or Overture calls. One Mapbox GL JS initialization counts as a map load. Panning and zooming do not add map loads, but reopening or returning to the route can initialize it again. At standard pay-as-you-go rates with the free allowance available, 100, 1,000, and 10,000 monthly loads cost US$0. The first 50,000 are free, and 100,000 monthly loads would cost about US$250. [Mapbox pricing](https://www.mapbox.com/pricing)

## Separate Google retention work

The existing Google Text Search importer persists business names, addresses, and coordinates on candidates; source rows duplicate name and address. Promotion copies them into restaurant rows, which still supply the feed and profile data. A candidate expiry date does not enforce deletion or carry through promotion. The Mapbox preview reads exclusively from reviewed location fields. Inventory and remediate the legacy stored fields under the plan in [the retained Google prototype notes](map-discovery.md).
