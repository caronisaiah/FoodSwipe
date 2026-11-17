-- M3 staging only. Run after pending import and explicit review of docs/nyc-map-location-review.md.
-- psql -X -h localhost -d foodswipe_map_staging -v reviewer='Name' -f scripts/stage-nyc-map-approvals.sql
\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'foodswipe_map_staging' OR inet_server_addr() IS NULL
      OR NOT (inet_server_addr() <<= inet '127.0.0.0/8' OR inet_server_addr() = inet '::1') THEN
    RAISE EXCEPTION 'Approval requires the local foodswipe_map_staging database over loopback TCP';
  END IF;
END
$guard$;

SELECT set_config('foodswipe.location_reviewer', :'reviewer', true);

CREATE TEMPORARY TABLE nyc_map_review (
  slug text PRIMARY KEY,
  overture_id text NOT NULL UNIQUE,
  release text NOT NULL,
  feature_version integer NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  source_dataset text NOT NULL,
  source_license text NOT NULL,
  identity_evidence_url text NOT NULL,
  display_name text NOT NULL,
  display_area text,
  display_address text NOT NULL,
  cuisine text,
  cuisine_evidence_url text,
  review_note text NOT NULL
) ON COMMIT DROP;

-- Only the eight points corroborated by first-party and NYC records enter this batch.
INSERT INTO nyc_map_review VALUES
  ('milk-burger', '29acb38a-fec7-47df-82a2-c0aaa2b622dc', '2026-10-21.0', 9, 40.80359455, -73.92005431, 'meta', 'CDLA-Permissive-2.0', 'https://milkburger.com/order/', 'Milk Burger', 'South Bronx', '148 Bruckner Blvd, Bronx, NY 10454', 'Smash burgers', 'https://milkburger.com/order/', 'Official branch, 7.9 m from the PAD point and 3.2 m outside BIN 2000005.'),
  ('emily', 'cb43a0e6-0935-4f90-81b9-4400c6d82523', '2026-10-21.0', 8, 40.68349896, -73.96644339, 'meta', 'CDLA-Permissive-2.0', 'https://www.pizzalovesemily.com/location/brooklyn/', 'Emily', 'Clinton Hill', '919 Fulton St, Brooklyn, NY 11238', 'Pizza & burgers', 'https://www.pizzalovesemily.com/location/brooklyn/', 'Brooklyn branch, 10.4 m from the PAD point and 0.7 m outside BIN 3056627.'),
  ('moonburger', '10f3b427-394d-451d-92f7-ced3b5b0c7b8', '2026-10-21.0', 3, 40.720954, -73.996296, 'Foursquare', 'Apache-2.0', 'https://www.moonburger.com/nolita', 'Moonburger', 'Nolita', '72 Kenmare St, New York, NY 10012', 'Burgers', 'https://www.moonburger.com/nolita', 'Nolita branch, 9.1 m from PAD and inside BIN 1007178. City inspection and operator corroborate the branch.'),
  ('deux-luxe', '51606d62-0432-4f75-aeb8-3ff5ce4cdfc5', '2026-10-21.0', 9, 40.720575103653076, -73.9965301736953, 'meta', 'CDLA-Permissive-2.0', 'https://www.deuxluxeny.com/', 'Deux Luxe', 'Nolita', '384 Broome St, New York, NY 10013', 'Wagyu burgers', 'https://www.deuxluxeny.com/', 'Inside BIN 1077744, 0.8 m from PAD. Operator and City records agree on ZIP 10013, correcting the Overture ZIP in the preview.'),
  ('gotham-burger-social-club', '350e4ab4-6c06-4a9c-93a8-2217568b6f52', '2026-10-21.0', 12, 40.72003623, -73.98753669, 'meta', 'CDLA-Permissive-2.0', 'https://www.gbsc.nyc/location/lower-east-side/', 'Gotham Burger Social Club', 'Lower East Side', '131 Essex St, New York, NY 10002', 'Smash burgers', 'https://www.gbsc.nyc/location/lower-east-side/', 'Flagship branch, 8.1 m from PAD and 4.6 m outside BIN 1005379.'),
  ('minetta-tavern', '54ab7e35-3ad2-4ec6-91b0-a8c91f5ed307', '2026-10-21.0', 11, 40.73000953, -74.00064852, 'meta', 'CDLA-Permissive-2.0', 'https://www.minettatavernny.com/hours-and-location', 'Minetta Tavern', 'Greenwich Village', '113 MacDougal St, New York, NY 10012', NULL, NULL, 'Official address, inside BIN 1008728 and 8.2 m from PAD. West 113th Street hit excluded.'),
  ('7th-street-burger-east-village', '17ece59a-640c-4919-b6da-e94cfbe67160', '2026-10-21.0', 11, 40.72689329, -73.98537317, 'meta', 'CDLA-Permissive-2.0', 'https://merch.7thstreetburger.com/pages/locations', '7th Street Burger East Village', 'East Village', '91 E 7th St, New York, NY 10009', 'Smash burgers', 'https://merch.7thstreetburger.com/pages/locations', 'First-party branch, 10.7 m from PAD and 2.9 m outside BIN 1005814.'),
  ('4-charles-prime-rib', 'f8b989d2-b102-4cb1-af01-7b5850fdd118', '2026-10-21.0', 10, 40.735144952599605, -74.00066077636762, 'meta', 'CDLA-Permissive-2.0', 'https://www.nycprimerib.com/about', '4 Charles Prime Rib', 'West Village', '4 Charles St, New York, NY 10014', 'Steakhouse', 'https://www.nycprimerib.com/about', 'Official address, inside BIN 1010849 and 2.7 m from PAD.');

DO $approval$
DECLARE
  eligible integer;
  reviewer text := trim(current_setting('foodswipe.location_reviewer', true));
BEGIN
  IF coalesce(reviewer, '') = '' THEN
    RAISE EXCEPTION 'Set the psql reviewer parameter to the person approving these locations';
  END IF;

  -- Lock and check every exact source feature before doing any writes. Prior
  -- approved rows are accepted only when the preview fields still agree.
  PERFORM 1
  FROM nyc_map_review a
  JOIN restaurants r ON r.slug = a.slug AND r.market = 'nyc' AND r.status = 'published'
  JOIN restaurant_locations l ON l.restaurant_id = r.id
    AND l.overture_id = a.overture_id AND l.release = a.release
    AND l.feature_version = a.feature_version AND l.lat = a.lat AND l.lng = a.lng
    AND l.identity_evidence_url = a.identity_evidence_url
    AND l.evidence->'sources'->0->>'dataset' = a.source_dataset
    AND l.evidence->'sources'->0->>'license' = a.source_license
  WHERE l.status = 'pending' OR (
    l.status = 'approved'
    AND ROW(l.display_name, l.display_area, l.display_address, l.cuisine, l.cuisine_evidence_url)
        IS NOT DISTINCT FROM ROW(a.display_name, a.display_area, a.display_address, a.cuisine, a.cuisine_evidence_url)
  )
  ORDER BY r.id
  FOR UPDATE OF r, l;
  GET DIAGNOSTICS eligible = ROW_COUNT;
  IF eligible <> (SELECT count(*) FROM nyc_map_review) THEN
    RAISE EXCEPTION 'Expected each reviewed point to match an eligible published NYC restaurant';
  END IF;

  UPDATE restaurant_locations l
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = reviewer,
      display_name = a.display_name,
      display_area = a.display_area,
      display_address = a.display_address,
      cuisine = a.cuisine,
      cuisine_evidence_url = a.cuisine_evidence_url,
      review_note = a.review_note
  FROM nyc_map_review a
  JOIN restaurants r ON r.slug = a.slug
  WHERE l.restaurant_id = r.id AND l.overture_id = a.overture_id
    AND l.release = a.release AND l.status = 'pending';
END
$approval$;

SELECT a.slug, l.overture_id, l.status, l.reviewed_at
FROM nyc_map_review a
JOIN restaurants r ON r.slug = a.slug
JOIN restaurant_locations l ON l.restaurant_id = r.id
  AND l.overture_id = a.overture_id AND l.release = a.release
ORDER BY a.slug;

COMMIT;
