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

**Current status:** working prototype on seeded Washington, DC data. Video
attachments persist to a shared Postgres table (Neon); restaurants remain seeded
in the repository. Mobile-first, dark, video-forward design.

---

## Features

- **Swipe discovery** — a full-screen, one-card-at-a-time deck with physics-based
  drag, Skip/Save controls, and arrow-key support. Cards are ordered by the
  preferences captured at onboarding.
- **Video-first profiles** — each restaurant reads like a creator profile: a hero
  clip, a scrollable review carousel, dish highlights, "best for" occasions, and
  social-proof metrics.
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

Design direction is dark and video-forward — deep charcoal surfaces, warm
coral-to-pink accents, and a display typeface — intended to feel like short-form
video rather than a reviews site or a dashboard.

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
```

`DATABASE_URL` and `FOODSWIPE_ADMIN_SECRET` enable shared persistence (the app
still runs without them). `YOUTUBE_API_KEY` is optional: with it, resolving a
YouTube URL prefills the real title, channel, thumbnail, and date; without it,
resolving still works with generic metadata. Get a key from the Google Cloud
console — create a project, enable the **YouTube Data API v3**, and create an API
key. The key is read server-side only and never logged.

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
  api/admin/videos/route.ts             POST  attach a video (admin secret)
  api/admin/videos/[id]/route.ts        DELETE soft-delete (admin secret)

components/
  PreferenceOnboarding.tsx   Landing and preference picker
  FeedClient.tsx             Ranks the deck and owns feed state
  SwipeDeck.tsx              Gesture, animation, controls, empty state
  RestaurantCard.tsx         The swipe card
  RestaurantProfile.tsx      Full profile (server-rendered)
  RestaurantVideos.tsx       Review carousel: seed + shared + local
  GoThere.tsx                Profile "Go there" links
  SavedClient.tsx            Saved list
  AdminVideos.tsx            Internal intake: resolve and attach to backend
  VideoEmbed.tsx             Status-driven, legal-safe video display
  SaveButton.tsx             Save toggle on profiles
  TagPill.tsx / MetricBadge.tsx   Presentational primitives
  AppShell.tsx / BottomNav.tsx    Mobile frame and navigation

lib/
  types.ts                   Domain types (Restaurant, Video, ...)
  video.ts                   Legal-safe core: normalize, enforce, embed allowlist
  youtube.ts                 YouTube URL resolver
  adminAuth.ts               Admin-secret check for write routes
  options.ts                 Controlled vocab and labels for onboarding
  recommendations.ts         Ranking
  storage.ts                 localStorage hooks (prefs, saves, legacy clips)
  emoji.ts                   Cuisine to placeholder glyph
  db/schema.ts               Drizzle table: restaurant_videos
  db/index.ts                Lazy Neon/Drizzle client
  db/videos.ts               Persisted video data access
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
