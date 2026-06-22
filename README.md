# FoodSwipe

Swipe-based restaurant discovery powered by short-form food-review video. Instead
of scrolling written reviews, you swipe through restaurant cards built around the
kind of food video people actually watch on TikTok, Reels, and YouTube Shorts.

**Strategy: aggregation-first.** Restaurant profiles are designed to pull together
public review content from TikTok, Instagram, YouTube, and the web. The product
never downloads, crops, stores, or rehosts third-party video — it embeds or links
to public sources with full platform and creator attribution.

> **v1.2 persistence proof.** The deployed app successfully attached a YouTube
> Shorts video through `/admin/videos` and displayed it on restaurant profiles
> across desktop and phone. This proves shared backend video persistence works
> outside `localStorage`.
>
> **v1.3 proof.** Deployed resolver successfully enriched a YouTube Shorts URL
> using `YOUTUBE_API_KEY`, prefilled title/channel/thumbnail/publishedAt, attached
> it to a restaurant profile, and displayed the enriched video in production.

**Current status:** working prototype on seeded Washington, DC data. Video
attachments persist to a shared Postgres table (Neon); restaurants remain seeded
in the repository. Mobile-first, dark, video-forward design.

---

## Features

- **Swipe discovery** — a full-screen, one-card-at-a-time deck with physics-based
  drag, Skip/Save controls, and arrow-key support. Cards are ordered by the
  preferences captured at onboarding.
- **Video-first profiles** — each restaurant reads like a creator profile: a hero
  clip, up to three same-size review videos, dish highlights, "best for"
  occasions, and social-proof metrics.
- **Transparent ranking** — a readable weighted score (craving, vibe, budget,
  dietary, distance, freshness, and video coverage). Every card states why it
  matched. No black-box scoring and no invented precision.
- **Legal-safe video** — what renders is driven by each clip's display status; a
  placeholder is never presented as a real post, and only allowlisted YouTube
  hosts can be embedded.
- **Shared persistence** — videos attached through the internal admin tool are
  stored in Postgres, so every device and browser sees the same profiles.

## Screens and routes

| Route | Purpose |
| --- | --- |
| `/` | Onboarding and landing — preference picker (location, distance, budget, cravings, vibe, dietary). Persists to `localStorage`, then continues to the feed. Doubles as the settings screen. |
| `/feed` | The swipe deck. Drag or tap Skip/Save; cards are ranked by preferences. |
| `/restaurants/[id]` | Restaurant profile: hero clip, metrics, what to order, best-for, review carousel, and external links. Statically generated per seeded id. |
| `/saved` | Saved (right-swiped) restaurants, with quick removal and profile links. |
| `/admin/videos` | Internal, non-public tool to resolve and attach review videos. `noindex`, admin-secret gated. |

API routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/resolve/youtube` | POST | Resolve a YouTube URL to a normalized, embeddable video reference. |
| `/api/restaurants/[id]/videos` | GET | Public read of active persisted videos for a restaurant. |
| `/api/admin/videos` | POST | Attach a video to a restaurant (admin-secret gated). |
| `/api/admin/videos/[id]` | DELETE | Soft-delete a persisted video (admin-secret gated). |

---

## How it works

### Video model and legal-safe display

Each video carries a small set of fields ([`lib/types.ts`](lib/types.ts)) that
make honest display enforceable rather than aspirational: `sourceType`
(`real-post` / `creator-profile` / `placeholder` / `manual-seed`),
`matchConfidence`, `isRealSource`, and `legalDisplayStatus`. The single
enforcement core is [`lib/video.ts`](lib/video.ts) — it normalizes untrusted
input, applies the embed allowlist, and decides what affordance each clip gets.

| `legalDisplayStatus` | Renders | External link |
| --- | --- | --- |
| `embeddable` (with an allowlisted embed URL) | official iframe embed | "View source" |
| `source-link-only` | preview card | "View original" for a genuine `real-post`, otherwise "View source" |
| `placeholder-only` | preview card | none — shows a "Source placeholder" chip |
| `unavailable` | muted preview | none — shows "Source unavailable" |

Rules in force everywhere:

- Never download, crop, store, or rehost third-party video.
- Always show platform and creator attribution.
- Prefer official embeds, oEmbed, and source links over scraping.
- Only allowlisted YouTube hosts can be embedded; a placeholder is never labeled
  a real post, and "View original" appears only for a verified `real-post`.

### YouTube ingestion

[`lib/youtube.ts`](lib/youtube.ts) extracts the video id from `watch?v=`,
`youtu.be/ID`, `/shorts/ID`, or `/embed/ID` (extra query parameters are fine),
then builds the canonical watch URL plus a privacy-enhanced
`youtube-nocookie.com/embed/ID` and runs it through the normalizer. The work
happens server-side in [`/api/resolve/youtube`](app/api/resolve/youtube/route.ts);
client input is never trusted.

**Optional metadata enrichment.** If `YOUTUBE_API_KEY` is set, the resolver also
calls the official Data API (`videos.list`) for that exact id and prefills the
title, channel, thumbnail, and publish date. It is best-effort: a missing key or
a failed request falls back to generic values, and the response reports a
`metadataStatus` (`enriched` / `missing-api-key` / `not-found` / `failed`).
Without a key, titles and creators are never invented — an unknown creator shows
as "Unknown creator" and the caption defaults to a generic label. This is
single-URL enrichment only: no search, no discovery, no scraping, and no video is
downloaded or rehosted (the thumbnail is referenced by URL, not stored).

YouTube **Shorts** are the priority format, matching the product's short-form
focus; standard watch URLs are supported as a fallback.

### Shared persistence

Videos attached through the admin tool persist to a single Postgres table,
`restaurant_videos` ([`lib/db/schema.ts`](lib/db/schema.ts)), via the Neon
serverless HTTP driver and Drizzle ORM. Only video attachments are persisted —
restaurants stay in [`lib/seed/restaurants.ts`](lib/seed/restaurants.ts).

- Reads ([`/api/restaurants/[id]/videos`](app/api/restaurants/[id]/videos/route.ts))
  are public, validate the restaurant id, re-normalize every row through
  `lib/video`, and degrade to an empty list if the database is unreachable so
  profiles never break.
- Writes ([`/api/admin/videos`](app/api/admin/videos/route.ts)) and soft-deletes
  are gated by a single shared secret (`FOODSWIPE_ADMIN_SECRET`), sent as the
  `x-foodswipe-admin-secret` header and compared in constant time. This is
  deliberately minimal write protection, not an account system.
- Profiles merge seed, shared (Postgres), and legacy local clips; the shared
  fetch is best-effort. The database client is lazy, so the app builds and runs
  without a database (the persisted list is simply empty and writes return `503`).

### Restaurant photos (Google Places)

A restaurant's profile hero should be the restaurant itself — food, storefront,
or interior — not a video thumbnail. The hero resolves in three honest tiers:

1. a real **Google Place Photo** (when the restaurant has a `googlePlaceId` and
   `GOOGLE_MAPS_API_KEY` is set);
2. otherwise the restaurant's **brand logo** on a premium centered card (when it
   has a known `websiteDomain` and `LOGODEV_TOKEN` is set);
3. otherwise the FoodSwipe **placeholder** (cuisine emoji + on-brand gradient).

A YouTube thumbnail is never promoted to a hero.

The Place Photo tier is wired on the restaurants that carry a verified
`googlePlaceId` (6 today); the others rely on the logo/placeholder tiers. Either
way the rules are the same:

- **Store only the Place ID.** `googlePlaceId` is the *only* Google datum kept
  long-term, in [`lib/seed/restaurants.ts`](lib/seed/restaurants.ts) — Google's
  policy explicitly permits caching Place IDs indefinitely. Restaurants stay in
  the seed; nothing moves into the database.
- **Fetch everything else fresh.** [`lib/places.ts`](lib/places.ts) (server-only)
  makes two minimal, field-masked calls per render: Place Details (New) for the
  first photo's `name` + `authorAttributions` (mask
  `photos.name,photos.authorAttributions`), then Place Photo (New) media with
  `skipHttpRedirect=true` for an ephemeral `photoUri`. The read route is
  [`/api/restaurants/[id]/photo`](app/api/restaurants/[id]/photo/route.ts);
  [`RestaurantHero`](components/RestaurantHero.tsx) consumes it client-side.
- **Never rehost.** The browser loads Google's ephemeral `photoUri` (a
  googleusercontent URL with no API key) **directly**. We never download, store,
  crop, proxy, or rehost the bytes — `next/image` is intentionally *not* used
  here because it would proxy the image through `/_next/image`.
- **Always attribute.** Any `authorAttributions` Google returns are displayed on
  the photo, as the policy requires.
- **Logo fallback (no rehosting either).** When there's no Place Photo but the
  restaurant has an official `websiteDomain`, the hero shows its brand logo via
  [Logo.dev](https://logo.dev) on a clean centered card (`object-contain`, never
  stretched or cropped full-bleed). The logo URL is built server-side in
  [`lib/logos.ts`](lib/logos.ts) and the browser loads it directly from Logo.dev's
  CDN — never downloaded, stored, or rehosted. The publishable token lives in
  `LOGODEV_TOKEN` (not `NEXT_PUBLIC_`). If the logo fails to load, the hero falls
  through to the placeholder.
- **Caching decision: `no-store`.** Google forbids caching the photo `name` (it
  can expire), and we never persist `photoUri` or attribution, so the route sends
  `Cache-Control: no-store` and every request resolves fresh. This is the
  conservative, policy-correct choice; a future version could add a short,
  policy-compliant edge cache if call volume warrants it.
- **Degrades cleanly.** Missing key, missing/stale Place ID, place not found, no
  photos, or any quota/network error all resolve to the logo tier (if a domain is
  set) or the placeholder hero — the profile never breaks. Place IDs were verified
  from public map URLs and should
  be re-confirmed with Google's Place ID Finder; Google also recommends
  refreshing Place IDs older than 12 months.

### Restaurant candidate ingestion (Phase 1)

A backend **review staging area** for discovering restaurants before they could
ever enter the feed. The product rule is explicit: **automation creates
candidates for human review, it never publishes to the feed.** The live app still
serves restaurants from [`lib/seed/restaurants.ts`](lib/seed/restaurants.ts) —
nothing here touches `/feed`, `/saved`, `/restaurants/[id]`, or the existing
`restaurant_videos` behavior.

- **Tables** ([`lib/db/schema.ts`](lib/db/schema.ts)): `candidate_restaurants`
  (curated, editable FoodSwipe fields + `status` candidate/approved/rejected/
  needs_review + `source` manual/google_places), `restaurant_sources`
  (provenance, kept separate from the curated fields — text metadata + reference
  URLs only, **never** photo bytes/URLs or downloaded media), and
  `ingestion_jobs` (optional batch-import bookkeeping, not yet wired).
- **Helpers** ([`lib/db/candidates.ts`](lib/db/candidates.ts)):
  `listCandidateRestaurants`, `getCandidateRestaurant`,
  `insertCandidateRestaurant`, `updateCandidateRestaurant`,
  `markCandidateRestaurantStatus`, `addRestaurantSource`. Status/source are
  re-validated on read and write — raw DB/body values are never trusted.
- **Admin API** (internal, `FOODSWIPE_ADMIN_SECRET`-gated like the video admin;
  503 without the secret or `DATABASE_URL`): `GET`/`POST`
  [`/api/admin/restaurants/candidates`](app/api/admin/restaurants/candidates/route.ts)
  and `PATCH`
  [`/api/admin/restaurants/candidates/[id]`](app/api/admin/restaurants/candidates/[id]/route.ts).
  Manual candidate creation only in this pass (no TikTok/Instagram/Google
  scraping, no Places Text Search yet).
- **Candidate vs live restaurant:** a candidate is mutable review data with a
  status and provenance and is **not** in the feed; a live restaurant is curated
  seed data served to users. Approval will later be a deliberate, curated
  promotion step — never an automatic publish.
- The new tables need a one-time migration to materialize (`npm run db:generate`/
  `db:push`, or apply the SQL in the Neon editor — see the TLS note above). The
  app builds and runs without them; candidate endpoints just return `503`.

**Phase 2 — Google Places candidate import.**
[`POST /api/admin/restaurants/candidates/import/google`](app/api/admin/restaurants/candidates/import/google/route.ts)
runs an official **Places API (New) Text Search** and turns results into review
candidates. It never publishes to `/feed`. Same guards as the other admin routes,
plus a **503** if `GOOGLE_MAPS_API_KEY` is unset and **400** on a blank `query`.

- **Body:** `{ query, maxResults? (1–20, default 10), dryRun? }`. `dryRun`
  **defaults to `true`** — you must send `"dryRun": false` to write. A dry run
  calls Google and returns normalized previews but **writes nothing** (not even an
  ingestion job). A real run inserts candidates (`status: "needs_review"`,
  `source: "google_places"`) + a `restaurant_sources` provenance row each, and
  returns `{ imported, skippedDuplicates, candidates }`. Both dry-run and real
  results are sorted by **review-likelihood** (below), highest first.
- **Exact Google fields requested** (minimal `X-Goog-FieldMask`, key via
  `X-Goog-Api-Key` header in `lib/places.ts` `searchPlacesText`): `places.id`,
  `places.displayName`, `places.formattedAddress`, `places.location`,
  `places.priceLevel`, `places.websiteUri`, `places.types`, `places.primaryType`,
  `places.rating`, `places.userRatingCount`. **Not requested:** photos, review
  text, editorial or generative summaries.
- **Stored:** `googlePlaceId` (long-term-cacheable per Google policy), plus
  Google-derived **review candidate** values — name, address, lat/lng, website
  host, a cleanly-mapped price level (Google enum → 1–4, else null), and `types`/
  `primaryType` recorded as a review note. The internal review-likelihood
  `score` + `reasons` are stored on `candidate_restaurants`; the raw
  `rating`/`userRatingCount` they derive from are recorded only in the
  `restaurant_sources` provenance note (admin metadata). Curated FoodSwipe fields
  (cuisine/vibe/dietary tags, dishes, copy) are **left empty** — never inferred
  from Google.
- **Not stored:** Google photo URLs/bytes or review text. Rating/review counts
  are **never displayed to users**, never shown in `/feed`, and never treated as
  FoodSwipe popularity — they exist only as expiring inputs to the internal
  triage score. The imported text is review-stage input for a human to curate,
  not a published Google mirror.
- **Review-likelihood (internal triage only).**
  [`lib/reviewLikelihood.ts`](lib/reviewLikelihood.ts) computes a 0–100 estimate
  of how likely a candidate **already has useful short-form social review
  content** worth curating — so a reviewer works the queue highest-first. It is
  **not** a rating, popularity, ranking, trending, or social-proof signal, is
  never shown to users, and never reaches `/feed`. Formula: review **volume**
  (`userRatingCount`, log-scaled, weight 80) dominates; `rating` is only a
  confidence **modifier** on that volume (×0.85–1.0, never standalone quality); a
  slight bonus for higher Google result position (≤10) and for having a website
  (8); a penalty for matching the seed feed (−25) or an existing candidate (−15).
  Score + human-readable `reviewLikelihoodReasons` persist on
  `candidate_restaurants`; both inputs are expiring Google metadata governed by
  the same `source_expires_at` window (re-import to recompute). Migration
  `0004_wide_dorian_gray.sql` adds the two nullable columns (additive, no default).
- **Freshness policy.** Google permits caching Place IDs indefinitely, but other
  Place content should be refreshed. Each Google-imported candidate records
  `source_fetched_at` (import time) and `source_expires_at` (**+30 days**) on
  `candidate_restaurants`, and a review note tells the reviewer to
  review/refresh the metadata before that date. These are review-stage markers
  only — never displayed publicly, never read by `/feed`. **Manual** candidates
  leave both null (the marker never blocks them). Nothing auto-expires yet;
  acting on the window is a deliberate human/curation step. Migration
  `0003_green_tattoo.sql` adds the two nullable columns (additive, no default).
- **Duplicates:** results are skipped when their `googlePlaceId` already exists as
  a candidate (this also catches repeats within one import). Results whose
  Place ID or name matches a **live seeded** restaurant are still imported but
  flagged with a `seedMatchWarning` (in the preview) and a note (on the row) —
  never a hard block.
- **`ingestion_jobs`** records each **real** import run (`source: google_places`,
  `query`, `dryRun: false`, `status: success|failed`, `candidatesCreated`,
  `skippedDuplicates`, `error`) for audit. Dry runs are intentionally not
  recorded. Migration `0002_kind_ultron.sql` adds `dry_run`, `skipped_duplicates`,
  and `error` to the table (additive, with defaults).

### Ranking

[`lib/recommendations.ts`](lib/recommendations.ts) is a pure, readable weighted
sum over craving, vibe, budget, dietary fit, distance, freshness, and a modest
video-coverage factor. It is easy to reason about and produces the honest
"why this matches you" copy shown on each card.

---

## Tech stack

- Next.js 16 (App Router) and React 19
- TypeScript (strict)
- Tailwind CSS v4 (CSS-first `@theme` tokens)
- framer-motion for swipe gestures and transitions
- Neon Postgres and Drizzle ORM for shared video persistence
- `localStorage` for client preferences and saved restaurants

Design direction is "Midnight Luxe" — a near-black charcoal stack with a single
warm saffron accent (chili red reserved for status), Montserrat display + Inter
body — intended to feel like short-form video rather than a reviews site or a
dashboard.

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # production build (also type-checks)
npm run start    # serve the production build
npm run lint     # eslint
```

The app is mobile-first. On desktop it renders as a centered phone-width column;
use your browser's device toolbar or narrow the window for the intended
experience. The app runs fully without a database — only the shared-persistence
features require one.

---

## Database and environment

Environment variables go in `.env` (which is gitignored). Use `.env` rather than
`.env.local`: Next.js reads both, but the drizzle-kit CLI only auto-loads `.env`.

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"   # Neon connection string (shared persistence)
FOODSWIPE_ADMIN_SECRET="a-long-random-string"                       # gate for admin writes
YOUTUBE_API_KEY="..."                                              # optional — YouTube metadata enrichment
GOOGLE_MAPS_API_KEY="..."                                          # optional — Google Place Photos on profiles
LOGODEV_TOKEN="pk_..."                                             # optional — brand-logo hero fallback (publishable token)
```

`DATABASE_URL` and `FOODSWIPE_ADMIN_SECRET` enable shared persistence (the app
still runs without them). `YOUTUBE_API_KEY` is optional: with it, resolving a
YouTube URL prefills the real title, channel, thumbnail, and date; without it,
resolving still works with generic metadata. Get a key from the Google Cloud
console — create a project, enable the **YouTube Data API v3**, and create an API
key. The key is read server-side only and never logged.

`GOOGLE_MAPS_API_KEY` is optional too: with it, restaurants that carry a
`googlePlaceId` show a real Google Place Photo as their profile hero; without it
(or on any failure) the hero falls back to the logo/placeholder tiers. Get a key
from the Google Cloud console — enable the **Places API (New)** and create an API
key. Like the others it is **server-only**: it is read only in `lib/places.ts`,
sent to Google via the `X-Goog-Api-Key` header, never prefixed with
`NEXT_PUBLIC_`, never exposed to the client, and never logged. See
[Restaurant photos](#restaurant-photos-google-places) for the legal-safe flow.

`LOGODEV_TOKEN` is optional: with it, a restaurant that has an official
`websiteDomain` but no Google Place Photo shows its **brand logo** on a premium
centered card instead of the generic placeholder. It is a [Logo.dev](https://logo.dev)
**publishable** image token (`pk_...`) — designed to appear in image URLs — but we
keep it in a non-`NEXT_PUBLIC_` env var so it is not inlined into the client JS
bundle: the logo URL is built server-side in `lib/logos.ts` and the browser loads
the image directly from Logo.dev's CDN. No token (or a failed logo load) falls
through to the placeholder. We never download, store, crop, or rehost the logo.

Create the table once. The simplest path:

```bash
npm run db:push        # apply the schema with drizzle-kit
# or:
npm run db:generate    # emit SQL migrations into ./drizzle
npm run db:studio      # browse the table
```

If `db:push` cannot connect — see the note below — apply the committed migration
[`drizzle/0000_cloudy_gargoyle.sql`](drizzle/0000_cloudy_gargoyle.sql) directly in
the Neon SQL editor instead.

### Managed laptops and corporate TLS interception

On a managed/corporate network, TLS may be intercepted. Node uses its own CA
bundle rather than the OS trust store, so the Neon driver's HTTPS request and
`drizzle-kit push` (which needs a WebSocket) can fail with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` even though `curl` and the browser work. This
is an environment trust issue, not an application bug.

- Do not disable TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
- If IT provides an approved corporate root CA, point Node at it with
  `NODE_EXTRA_CA_CERTS`. This trusts the same CA the OS already does; it does not
  weaken verification.
- Otherwise, exercise the database from a deployment or a non-intercepted network
  — the HTTP driver connects normally there.

---

## Deployment

The app deploys cleanly to Vercel:

1. Import the GitHub repository in Vercel (Next.js is auto-detected; defaults are
   fine).
2. Add `DATABASE_URL` and `FOODSWIPE_ADMIN_SECRET` as environment variables, then
   deploy (or redeploy if the variables were added after the first build).
3. Create the `restaurant_videos` table once — via the Neon SQL editor using the
   committed migration, or `db:push` from a non-intercepted network.

The build does not require a database; routes read environment variables at
request time. Because deployment runs on a clean network, the Neon driver
connects normally, which is the environment where shared persistence was proven.

---

## Project structure

```
app/
  layout.tsx                 Root layout: fonts, metadata, viewport
  globals.css                Tailwind v4 @theme tokens and utilities
  page.tsx                   "/" onboarding and landing
  feed/page.tsx              "/feed"
  saved/page.tsx             "/saved"
  restaurants/[id]/page.tsx  "/restaurants/[id]" (static per seeded id)
  restaurants/[id]/not-found.tsx        404 for an unknown restaurant id
  admin/videos/page.tsx      "/admin/videos" (internal, noindex)
  api/resolve/youtube/route.ts          POST  resolve a YouTube URL
  api/restaurants/[id]/videos/route.ts  GET   active persisted videos
  api/restaurants/[id]/photo/route.ts   GET   fresh Google Place Photo (or null)
  api/admin/videos/route.ts             POST  attach a video (admin secret)
  api/admin/videos/[id]/route.ts        DELETE soft-delete (admin secret)
  api/admin/restaurants/candidates/route.ts      GET/POST candidate restaurants (admin secret)
  api/admin/restaurants/candidates/[id]/route.ts PATCH a candidate (admin secret)
  api/admin/restaurants/candidates/import/google/route.ts  POST Google Places Text Search import (admin secret)

components/
  PreferenceOnboarding.tsx   Landing and preference picker
  FeedClient.tsx             Ranks the deck and owns feed state
  SwipeDeck.tsx              Gesture, animation, controls, empty state
  RestaurantCard.tsx         The swipe card
  RestaurantProfile.tsx      Full profile (server-rendered)
  RestaurantHero.tsx         Profile hero: Google Place Photo or placeholder
  RestaurantVideos.tsx       Review carousel: seed + shared + local
  GoThere.tsx                Profile "Go there" links
  SavedClient.tsx            Saved list
  AdminVideos.tsx            Internal intake: resolve and attach to backend
  VideoEmbed.tsx             Status-driven, legal-safe video display
  SaveButton.tsx             Save toggle on profiles
  TagPill.tsx / MetricBadge.tsx   Presentational primitives
  AppShell.tsx / BottomNav.tsx    Mobile frame and navigation

lib/
  types.ts                   Domain types (Restaurant, Video, PlacePhoto, ...)
  video.ts                   Legal-safe core: normalize, enforce, embed allowlist
  youtube.ts                 YouTube URL resolver
  places.ts                  Server-only Google Place Photo resolver
  adminAuth.ts               Admin-secret check for write routes
  options.ts                 Controlled vocab and labels for onboarding
  recommendations.ts         Ranking
  storage.ts                 localStorage hooks (prefs, saves, legacy clips)
  emoji.ts                   Cuisine to placeholder glyph
  db/schema.ts               Drizzle tables: restaurant_videos, candidate_restaurants, restaurant_sources, ingestion_jobs
  db/index.ts                Lazy Neon/Drizzle client
  db/videos.ts               Persisted video data access
  db/candidates.ts           Candidate-restaurant review data access (Phase 1 ingestion)
  seed/restaurants.ts        18 seeded Washington, DC restaurants

drizzle.config.ts            drizzle-kit configuration
drizzle/                     Generated SQL migrations
```

Architecture seams kept stable so the product can grow:

- `lib/types.ts` is the data contract; the same shapes can back a real ingestion
  pipeline.
- Persistence has two seams: `lib/storage.ts` (client preferences and saves) and
  `lib/db/` (shared video attachments, behind the API routes).
- `VideoEmbed` plus `lib/video.ts` is the only video-display surface.
- Ranking is isolated and pure in `lib/recommendations.ts`.

---

## Scope and limitations

- Restaurants are hand-authored seed data (18 spots), not ingested.
- Seed clips are honest placeholders or real discovery-search links; genuine
  embeds are added through the admin tool.
- **A profile shows at most 3 videos**, in a vertical same-size stack, ordered
  deterministically (real-post → embeddable → enriched → newer → original). This
  is a **display rule, not a database/admin limit** — the backend may store more
  active videos per restaurant (for future ranking/moderation/replacement); the
  public profile renders only the top 3.
- **YouTube thumbnails are video-preview assets only** — never used as a
  restaurant hero/profile image.
- **Profile heroes can be real Google Place Photos**, currently proven on 3
  restaurants with a `googlePlaceId` (see [Restaurant photos](#restaurant-photos-google-places)).
  Only the Place ID is stored; photos are fetched fresh, attributed, never
  rehosted, and absent a key/photo the hero falls back to the placeholder. Feed
  cards do not use Google photos; Google ratings, reviews, and maps are out of
  scope.
- Video attachments are shared across devices via Postgres; legacy `localStorage`
  clips remain as a labeled fallback. Both appear on profiles, not in the feed
  deck (which keeps a stable hero).
- User preferences and saves are `localStorage` only — per browser, no accounts.
- Admin writes are protected by a single shared secret, not a full auth system.
- Distances and coordinates are placeholders; no maps or geolocation.
- Intentionally out of scope: scraping, creator or owner accounts, payments,
  reservations, comments, social features, full authentication, and moving
  restaurants into the database.

---

## Roadmap

1. **Bulk metadata back-fill** — per-resolve YouTube enrichment ships today; next,
   back-fill titles, creators, thumbnails, and dates for already-attached videos.
2. **Broader ingestion** — official oEmbed and discovery for additional platforms,
   with a moderation and quality pass.
3. **Accounts and synced saves** — light authentication so saved restaurants and
   swipe history follow the user across devices.
4. **Real distance** — geolocation and a maps provider for true distances and a
   "near me" sort.
5. **Smarter ranking** — feed swipe history back into the score and add cuisine
   diversity.
6. **Restaurants in the database** — graduate seed data into the persistence layer
   behind the existing type contract.
