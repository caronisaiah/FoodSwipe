# Shared discovery market

Tune writes the chosen market through a validated Next.js Server Action. The
action sets a one-year, host-only, HTTP-only, same-site cookie. Production
builds add the secure attribute. The action requires Origin and uses Next.js's
same-origin Server Action checks. Tune, Swipe, and Map read the same cookie on
the server. Next refreshes the route and invalidates cached navigation payloads
when the action changes the cookie. URLs stay stable, so Back and Forward
change pages and retain the current choice. First render and hydration use
the same market. Browser-local recommendation preferences remain independent
of the market cookie, as does any future device location.

- **Technical support.** The existing IDs are `nyc` and `dc`.
- **Public selection.** NYC is enabled by default. Set
  `FOODSWIPE_ENABLE_DC_DISCOVERY=true` with the local development server
  to offer DC. Production builds ignore that flag. California and Vancouver
  have no selectable market IDs yet.
- **Catalogues.** The enabled list is policy, independent of DB publication
  and content mode. An enabled market can have zero restaurants. Published DC
  profiles can still resolve by slug, as before. Mixed or demo mode may include
  the existing DC seeds. Production content mode serves published rows only.
- **Default and recovery.** A missing or blank `FOODSWIPE_DEFAULT_MARKET`
  defaults to NYC. An explicit invalid or disabled default leaves discovery
  unavailable until a valid selection is made. A stale or invalid cookie
  resolves to the configured default when available. Tune explains the recovery
  and lets the user confirm the fallback.
- **Read contract.** The unqualified restaurant API uses the effective market.
  An explicit canonical `?market=nyc` or `?market=dc` reads that enabled
  catalogue. Invalid or repeated parameters return 400, disabled markets
  return 403, and read failures or unavailable discovery return 503. A
  successful empty catalogue returns 200. Tune and Swipe request the exact
  market, validate the response's market and rows, and abort superseded reads.
- **Map.** The active Mapbox route queries only approved locations joined to
  published restaurants in that market. It shows an empty state when a valid
  market lacks approved locations. The Google prototype remains disconnected
  from public navigation.
- **Saved.** The client keeps existing IDs and ordering and looks them up in
  bounded batches by public slug across markets. The lookup honors the same
  publication and seed rules as a public profile and returns only saved-card
  and analytics fields. Database slugs are globally unique. Seed slugs are
  reserved at promotion and win in content modes that show seeds. Discovery
  and Map omit any DB record whose link would resolve to a seed. Hidden, missing, or
  seed-only records in production remain in browser storage, with an
  unavailable count in the UI. A fetch failure has a separate retry state.
  This phase does not migrate data. Start Over still clears the swipe history
  that currently supplies favorites.

For isolated local NYC/DC QA, run
`FOODSWIPE_DEFAULT_MARKET=nyc FOODSWIPE_ENABLE_DC_DISCOVERY=true npm run dev -- --hostname 127.0.0.1`. Mixed
mode can pair the local read-only NYC staging catalogue with the existing DC
seed catalogue. Use only an isolated database. Run the same checks with the
DC opt-in present in a production build to verify the public selection policy.
