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
- **Shared resolver.** The photo→logo→placeholder ladder lives once in
  [`lib/heroMedia.ts`](lib/heroMedia.ts) (`resolveHeroMedia({ googlePlaceId,
  websiteDomain })`, server-only). Both the public photo route and the admin
  candidate photo route call it, so seed restaurants and review candidates get
  the identical honest tiers and the same `{ photo, status, logoUrl }` shape.
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
- **Exact duplicates (by `googlePlaceId` only), race-hardened.** A real import
  skips any result whose `googlePlaceId` already exists as a candidate —
  regardless of its status (`candidate`/`needs_review`/`approved`/`rejected`), and
  it **never revives a rejected row**. Dedupe is **never by name** (chains have
  many locations, so same-name/different-Place-ID results import as distinct
  candidates). Three layers guard against duplicates: a within-run `Set` (same
  Place ID twice in one Google response), the status-independent
  `getCandidateByGooglePlaceId` pre-check, and **insert-failure recovery** — if an
  insert throws because a concurrent import inserted the same Place ID between the
  check and the insert (a TOCTOU race, the root cause of the earlier
  duplicate-on-retry bug), the loop re-checks and counts it as a skipped duplicate
  instead of creating a second row. Skips are counted in `skippedDuplicates` and
  itemized in `duplicates[]` (`{ googlePlaceId, name, existingId, existingStatus,
  reason: "existing-candidate" | "within-batch" | "race" }`); a dry run marks each
  with `isDuplicate` + `duplicateOfStatus`. Safe server logs (Place IDs + reason,
  no secrets) record what was skipped. The race is closed at the database level by
  a **partial `UNIQUE` index** on `google_place_id` (migration
  `0006_serious_stellaris.sql`, `WHERE google_place_id IS NOT NULL` so manual rows
  may stay null): a concurrent duplicate insert now throws, and the route's
  insert-conflict recovery records it as a skipped duplicate instead of creating a
  second row. That migration first **de-dupes** any pre-existing duplicates,
  keeping the most-recently-updated candidate per Place ID and deleting the
  redundant copies (the console flags such rows with a "dup ID" badge). Separately,
  results matching a **live seeded** restaurant by Place ID or name are imported
  but flagged with a `seedMatchWarning` — never a hard block.
- **Conservative auto tag suggestions.** [`lib/candidateTagger.ts`](lib/candidateTagger.ts)
  (pure, deterministic) maps Google `primaryType`/`types`/name/`query`/price to
  **controlled-vocab** review tags (`lib/types.ts`): cuisine + an implied dish
  only when the type/name clearly says so (taqueria→Tacos, ramen→Ramen,
  pizza→Pizza, bakery→Pastries, ice-cream→Ice cream); dietary tags **only when
  explicit** (never assumed); vibe/`bestFor` from price + an obvious service style;
  a neutral `reasonText` template (not marketing). Every suggestion is explained in
  `suggestionReasons`. Import applies suggestions to NEW candidates only (existing
  ones are skipped, never overwritten); the dry run shows them in the preview. The
  suggestion snapshot (`suggested_tags` jsonb) + `suggestion_confidence` +
  `suggestion_reasons` persist on `candidate_restaurants` so the console can show
  auto-vs-human-edited and offer "reset to suggestions". Migration
  `0005_lame_colleen_wing.sql` adds the three nullable columns (additive).
- **Admin photo preview (lazy).** [`GET /api/admin/restaurants/candidates/[id]/photo`](app/api/admin/restaurants/candidates/[id]/photo/route.ts)
  (admin-secret, `no-store`, read-only — no DB writes) resolves the candidate's
  hero media via the shared `resolveHeroMedia` and returns the same
  `{ photo, status, logoUrl }` shape as the public route. To bound Google cost the
  console fetches a candidate's photo only when its row is **expanded** (not for
  every queue row, and never for dry-run preview rows).
- **Review console.** [`/admin/restaurants/candidates`](app/admin/restaurants/candidates/page.tsx)
  is a dense internal queue: rows ranked by review-likelihood (null/manual last),
  with status + source filters, name/address/Place-ID search, and per-row flags
  (duplicate Place ID, seed overlap, expiry). Expand a row to review/edit
  controlled-vocab tags (with auto-vs-edited markers), `reasonText`, and notes, and
  to Save / Mark needs-review / Approve / Reject / Reset-to-suggestions. **Approve
  marks a candidate reviewed only — it never publishes to `/feed`.**
- **`ingestion_jobs`** records each **real** import run (`source: google_places`,
  `query`, `dryRun: false`, `status: success|failed`, `candidatesCreated`,
  `skippedDuplicates`, `error`) for audit. Dry runs are intentionally not
  recorded. Migration `0002_kind_ultron.sql` adds `dry_run`, `skipped_duplicates`,
  and `error` to the table (additive, with defaults).

### Promotion to the live feed (DB-published restaurants)

Reviewed candidates can become **live feed restaurants** through a deliberate,
admin-only promotion — never automatically. `/feed` now serves the code-managed
seed **plus** DB-published restaurants.

- **Schema.** A new `restaurants` table (migration `0007_outstanding_gauntlet.sql`)
  holds published restaurants with everything the `Restaurant` type needs, a
  `status` (`published`/`hidden`), `sourceCandidateId`, and unique indexes on
  `slug`, `sourceCandidateId`, and `googlePlaceId` (so a candidate / Place ID can
  only be promoted once). Seed restaurants are untouched and stay in code.
- **Promotion.** [`POST /api/admin/restaurants/candidates/[id]/promote`](app/api/admin/restaurants/candidates/[id]/promote/route.ts)
  (admin-secret) requires the candidate to be **`approved`** (else `400`) and to
  have the required feed fields — `name`, `address`, `priceLevel`, `lat`/`lng`,
  non-empty in-vocab `cuisineTags`, a `vibeTags`-or-`bestFor`, and `reasonText`
  (else `422` with `missingFields`). It copies only reviewed/curated fields
  (re-validated against the controlled vocab), computes a real `distanceMiles`
  from a DC origin, and is idempotent — a second promote returns the existing
  restaurant (`409`), never a duplicate. It never publishes videos or touches
  Google photo data.
- **No fabricated social proof.** Published restaurants get **neutral-zero**
  `trendScore`/`vibeScore`/`videoCount`/`recentVideoCount`/`saveCount` —
  documented internal placeholders, not real metrics. So they never earn a
  "Trending"/"Top Choice" badge (thresholds 75/90), and the profile hides the
  "hype" metric strip when it's all zero (showing just the reason). Each gets one
  clearly-labelled placeholder video so the non-empty `videos` tuple holds without
  inventing content.
- **Feed merge.** [`lib/db/restaurants.ts`](lib/db/restaurants.ts) exposes
  `getAllRestaurants()` (seed + published) behind the public
  [`GET /api/restaurants`](app/api/restaurants/route.ts) (`no-store`). The feed
  and saved screens start from seed (instant + offline-safe) and merge in the DB
  list once fetched; a DB outage degrades to seed-only and never empties the feed.
  `/restaurants/[id]` keeps seed pages static (via `generateStaticParams`) and
  renders published pages on demand; the photo + videos routes resolve seed **or**
  published ids. Tags are re-validated on read — DB arrays are never trusted blindly.
- **Editing after promotion.** [`GET /api/admin/restaurants/published`](app/api/admin/restaurants/published/route.ts),
  [`PATCH /api/admin/restaurants/published/[id]`](app/api/admin/restaurants/published/[id]/route.ts),
  and [`POST …/[id]/hide`](app/api/admin/restaurants/published/[id]/hide/route.ts)
  back the [published editor](app/admin/restaurants/published/page.tsx). PATCH is
  additive and **drops out-of-vocab tags**; it can edit name/neighborhood/address/
  domain/Place-ID/lat-lng/price/tags/dishes/reason and `status`, but never
  `sourceCandidateId`, `slug`, or the metric fields. The candidates console gains
  a **Promote to feed** action on approved candidates (showing `missingFields` on
  failure and the resulting `/restaurants/[slug]` link on success).

### Social video intake (Phase 1)

A **review-first** queue for TikTok / Instagram / YouTube URLs. Nothing is attached
to a profile automatically — a video only reaches `restaurant_videos` after an
admin **approves** a candidate and explicitly **attaches** it.

- **Schema.** A new `video_candidates` table (migration `0008_simple_rage.sql`)
  separate from `restaurant_videos`, with `status`
  (`needs_review`/`approved`/`rejected`/`attached`), resolver metadata, and unique
  indexes on `normalized_source_url` and partial `(platform, platform_video_id)`
  so the same URL can't queue twice. `restaurant_videos` is unchanged.
- **Resolver** ([`lib/socialVideo.ts`](lib/socialVideo.ts), server-only): detects
  platform, normalizes the URL (the dedupe key), extracts a platform video id, and
  fetches **official, public** metadata only.
  All three resolve to the platform's **official iframe embed** so attached videos
  play **inline** (no download/rehost; validated by `lib/video.isEmbedUrlAllowed`,
  which checks host + exact official-embed path):
  - **TikTok** — public **oEmbed** (no key) for creator/caption/thumbnail + the
    official **embed iframe** (`tiktok.com/embed/v2/{id}`), `embeddable` when the
    numeric id is extractable; short links (vm./vt.) stay `source-link-only`.
  - **YouTube** — reuses [`lib/youtube.ts`](lib/youtube.ts): canonical + nocookie
    embed (`embeddable`), optional Data-API metadata.
  - **Instagram** — official **`/{p|reel|tv}/{code}/embed/` iframe** (`embeddable`,
    no embed.js script, no token needed); the optional `INSTAGRAM_OEMBED_TOKEN`
    only **enriches** metadata when set (its absence no longer means link-out).
  - Unknown/unsupported URL → a clean **422** validation error.
  - No scraping, no unofficial downloaders, **no media bytes stored**; thumbnails
    are kept **by reference** (validated https) like the existing video model.
- **Admin APIs** (all admin-secret gated · 503/401/503):
  - `POST /api/admin/videos/candidates` — `{ sourceUrl, restaurantSlug?,
    candidateRestaurantId?, proposedRestaurantName?, reviewNotes? }` → resolves +
    inserts `needs_review`. **422** unsupported URL; **409 (with existing)** on dup.
  - `GET /api/admin/videos/candidates?status=&platform=&restaurantSlug=`.
  - `PATCH /api/admin/videos/candidates/[id]` — edits review fields only
    (status `needs_review`/`approved`/`rejected`, restaurantSlug, proposed name,
    creatorHandle, caption, attributionText, matchConfidence, matchReasons,
    reviewNotes). Source identity + `attached` are not editable here.
  - `POST /api/admin/videos/candidates/[id]/attach` — requires `approved` (else
    **400**) + a `restaurantSlug` resolving to a seed/published restaurant (else
    **422**); inserts via the existing legal-safe `normalizeVideo` + `insertVideo`,
    marks the candidate `attached`. **Idempotent**; **never** attaches a
    rejected/needs_review candidate; never auto-runs.
- **Console.** [`/admin/videos/candidates`](app/admin/videos/candidates/page.tsx):
  URL intake (with a restaurant-slug typeahead), status/platform filters, a compact
  queue, expandable detail that plays the official embed inline (TikTok/IG/YouTube)
  or shows thumbnail + source link, resolver diagnostics, match confidence/reasons,
  editable review notes, and Save/Approve/Reject/Attach (Attach disabled unless
  approved + slug). The existing [`/admin/videos`](app/admin/videos/page.tsx) intake
  tool is unchanged.

### Profile editor (admin)

[`/admin/restaurants/profile`](app/admin/restaurants/profile/page.tsx) is a
restaurant-centric admin page (alongside the review queue): pick a restaurant via
the slug typeahead, then edit its tags + manage its videos in one place.

- **Tags.** Published DB restaurants are fully editable (via the existing
  vocab-validated `PATCH /api/admin/restaurants/published/[id]`); seed restaurants
  are code-managed, so their tags are shown **read-only** with a note.
- **Videos.** Lists the profile's current videos (with an inline-vs-link-out
  indicator) and removes them via the existing soft-delete
  `DELETE /api/admin/videos/[id]`. **Add** resolves a URL through the same official
  resolver + legal-safe `normalizeVideo`/`insertVideo` and attaches it directly to
  the restaurant ([`POST /api/admin/restaurants/[slug]/videos`](app/api/admin/restaurants/[slug]/videos/route.ts),
  admin-gated, dedupes by source URL). This is a deliberate direct attach for an
  admin curating a known profile — the review queue remains the path for
  *discovered* videos. Only **visible** restaurants (seed + published) appear in the
  picker; hidden published restaurants are managed from the published editor.

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
  api/admin/restaurants/candidates/[id]/photo/route.ts  GET candidate hero preview (admin secret, no-store)
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
