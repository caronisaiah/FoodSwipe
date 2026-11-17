# FoodSwipe M3 staging and Vercel Preview

## Persistent staging on this Mac

The dedicated PostgreSQL 18.6 database is `foodswipe_map_staging` at `127.0.0.1:55483`. Its data and private connection files live outside the repo under `~/Library/Application Support/FoodSwipe/staging-m3`. It contains ten local profile rows with the existing public slugs and twenty existing public video references. Its internal IDs are local IDs, and production restaurant rows, Google-derived business fields, and Google photos were never used as a database seed.

The actual loopback guard in the approval SQL ran in PostgreSQL. Migration `0012` and the Overture pending import ran before the explicit eight-location approval. Au Cheval remains pending. Smacking Burger is still unmatched and has no location row. A deliberately altered Emily coordinate caused the whole approval to fail. After restoring the reviewed value, applying the script twice preserved the original approval timestamps, reviewer and fields. PostgreSQL was restarted and returned the same rows from disk. The staged catalog, video records and one synthetic hero-selection sentinel matched their snapshots. The [approval review](nyc-map-location-review.md) records the source IDs, branch evidence and reasons for the two holds.

Desktop Chrome and a 390×844 touch viewport loaded live Mapbox Standard tiles from this database. All eight marker labels, preview identities, and profile slugs matched. Selected markers used a clear ring, previews stayed within the viewport, and the zoom controls did not overlap attribution. Desktop keyboard activation and focus return, mobile tap, pan, and pinch, zoom controls, profile links, and Back passed. `/feed` made zero Mapbox requests. Production read-only snapshots of the ten NYC profiles and twenty videos matched. Moonburger and Deux Luxe are about 46 m apart. Their marker centers were 2.2 px apart in the fitted mobile overview. Pinch zoom separated them by 54.1 px, and both then opened the correct previews when tapped. On the narrow viewport, the count badge can sit over an edge pin after the preview pans the map.

To open the local map, run the prepared launcher from Terminal and go to `http://localhost:3000/map`. It uses the restricted browser token in the ignored repo `.env.local`, starts PostgreSQL if required, and supplies a loopback HTTP bridge with a read-only database role for the existing Neon client. The launcher expects the current Next.js build in `.next`. After a source change, rebuild with `FOODSWIPE_CONTENT_MODE=production FOODSWIPE_DEFAULT_MARKET=nyc npm run build`.

```sh
"$HOME/Library/Application Support/FoodSwipe/staging-m3/start-local-qa.sh"
```

## Protected Vercel Preview

Before any external change, check the live FoodSwipe project's Production environment variable names and confirm `FOODSWIPE_MAP_ENABLED` is absent. A 404 at production `/map` confirms the route is unavailable but does not establish the flag's configured value. In Neon, verify that the QA project ID and direct compute endpoint are distinct from FoodSwipe production. In Vercel, verify the selected project and team, connected integrations, and any shared or integration-managed Preview environment variables. The QA project should have no attached database integration and one manually supplied Preview `DATABASE_URL`. Integration-managed variables can supply `DATABASE_URL`; the app reads that exact variable. Stop if any target or override is uncertain. [Vercel integration configuration](https://vercel.com/docs/cli/integration) · [Neon projects](https://neon.com/docs/manage/projects)

1. With authorization, use a separate Neon project for QA with PostgreSQL 18 and an empty database named `foodswipe_map_staging`. Use the verified **direct** QA writer endpoint for restore.
2. Restore the validated `preview.dump` from the local staging directory. It has the schema through migration `0012`, ten local profiles, twenty public video references, eight approvals, and one pending Au Cheval location. Smacking Burger has no location row. The archive omits the synthetic hero selection, database role definitions, and grants. The migration and approvals are already in the archive, so there is no follow-up migration or approval command. Store the QA writer connection in a private libpq service and password file as `foodswipe_map_preview_writer`. The service should name the verified endpoint, port, database and user and use TLS host verification (`sslmode=verify-full`, with a trusted CA configured). Use a matching private password file entry:

   ```sh
   unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGOPTIONS PGSERVICE
   test "$(psql -X 'service=foodswipe_map_preview_writer' -Atc \
     "SELECT current_database(), count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f');")" = 'foodswipe_map_staging|0' || exit 1
   pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
     --dbname='service=foodswipe_map_preview_writer' \
     "$HOME/Library/Application Support/FoodSwipe/staging-m3/preview.dump"
   psql -X 'service=foodswipe_map_preview_writer' -Atc \
     "SELECT (SELECT count(*) FROM restaurants WHERE market='nyc' AND status='published'),
             (SELECT count(*) FROM restaurant_videos WHERE status='active' AND is_real_source),
             (SELECT count(*) FROM restaurant_locations l JOIN restaurants r ON r.id=l.restaurant_id
              WHERE r.market='nyc' AND r.status='published' AND l.status='approved');"
   ```

   The final query should return `10|20|8`. Create an ordinary SQL login role in QA without administrator membership. Set its password privately and grant `CONNECT` on the QA database, `USAGE` on `public`, and `SELECT` on its tables. Before adding the reader connection to Vercel, sign in with it and verify that the count query works and the role has no effective write privileges:

   ```sql
   SELECT current_database(),
          NOT has_schema_privilege(current_user, 'public', 'CREATE') AS no_schema_create,
          NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
              AND has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
          ) AS no_table_writes;
   ```

   Expect `foodswipe_map_staging|t|t`. Keep the writer connection out of the app.
3. Create a dedicated Vercel project named `foodswipe-map-qa` with no Git integration. Enable **Vercel Authentication** with **Standard Protection** so your intended testers can sign in. In **Settings → Environment Variables**, add these values for **Preview** only. [Vercel Preview variables](https://vercel.com/docs/environment-variables#preview-environment-variables) · [Deployment protection](https://vercel.com/docs/deployment-protection)

   | Variable | Preview value |
   |---|---|
   | `DATABASE_URL` | Neon reader connection string for the isolated QA database |
   | `MAPBOX_PUBLIC_TOKEN` | Dedicated public `pk.` token for Preview, with `styles:read` and `fonts:read` |
   | `FOODSWIPE_MAP_ENABLED` | `true` |
   | `FOODSWIPE_DEFAULT_MARKET` | `nyc` |
   | `FOODSWIPE_CONTENT_MODE` | `production` to use the database catalog without demo seeds. The Vercel deployment target is still Preview. |

   Leave Google Places, admin, and analytics credentials unset on this dedicated project. Keep `FOODSWIPE_MAP_ENABLED` off in the live project's Production environment.
4. From the repo root, copy only Git-tracked and non-ignored source files into a private deployment directory. Include the reviewed unstaged map files, and compare the files with the release preflight manifest before uploading. Link only the isolated QA project and verify protection and environment metadata before deploying explicitly to Preview. [Vercel CLI linking](https://vercel.com/docs/cli/link) · [Vercel CLI deployment](https://vercel.com/docs/cli/deploy)

   ```sh
   umask 077
   preview_dir=$(mktemp -d)
   git ls-files -z --cached --others --exclude-standard |
     rsync -a --from0 --files-from=- --exclude='.git' --exclude='.env*' \
       --exclude='.vercel' --exclude='node_modules' --exclude='.next' \
       --exclude='*.tsbuildinfo' ./ "$preview_dir/"
   cd "$preview_dir"
   unset VERCEL_ORG_ID VERCEL_PROJECT_ID
   vercel link --project foodswipe-map-qa
   vercel env ls preview
   vercel deploy --target=preview
   ```

   In the Mapbox token settings, allow the exact HTTPS origin returned by the deploy command. Use that protected Preview URL followed by `/map`; no production alias is required. If the token value changes, update the Preview variable and redeploy. If only the token's allowed origin changes, the deployment itself can stay as is. [Mapbox URL restrictions](https://docs.mapbox.com/accounts/guides/tokens/#url-restrictions)
5. Verify the deployment is marked Preview and that an unauthenticated request meets the Vercel sign-in gate. Sign in, confirm the effective Preview database variable targets the read-only QA endpoint, and check ten NYC profiles and two real-source videos per profile. Open `/map`. Confirm eight pins, the correct profile and Back behavior, and the exclusion of Au Cheval and Smacking Burger. Use the browser network panel to check the Mapbox basemap and attribution, zero Mapbox initialization on `/feed`, and zero Google Places, Overture or geocoding requests on `/map`. Recheck the production Production flag and compare the public profile and video snapshots. Share the protected Preview URL with the intended reviewers.

## Physical-device checklist

Open the exact HTTPS Preview URL on an iPhone with Safari and an Android phone with Chrome. Sign into Vercel first. In portrait and landscape, check map load, one-finger pan, pinch zoom, and tapping a pin near the viewport edge. Select Emily and verify `919 Fulton St, Brooklyn, NY 11238`, the selection ring, the readable preview, the profile link and Back. Zoom into Nolita and select both Moonburger and Deux Luxe. Check that the compact attribution button opens and is clear of the map controls and home indicator. Close the preview, switch to Swipe, and confirm it still works. Record the device, OS, browser and any layout or touch failure. The desktop and touch-viewport tests on this Mac do not count as physical-device testing.

## Production blockers

- The hosted QA database, restricted Preview origin and real-device sign-off are still needed before release review.
- Keep Au Cheval off the map until its guest entrance is independently confirmed. Smacking Burger stays off pending an independently verified point and, if a Mapbox Permanent result is used, confirmed rights to deliver it to public browsers.
- The existing feed and profiles still read Google-derived fields written by the legacy importer. Inventory those fields, replace or remove restricted copies, and implement retention enforcement separately. [Google data retention plan](map-discovery.md#existing-retention-and-migration)
