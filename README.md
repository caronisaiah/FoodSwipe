# 🍔 FoodSwipe — MVP v1

**Swipe through restaurants powered by real food-review videos.**

FoodSwipe is a swipe-based restaurant discovery prototype. Instead of reading
reviews, you swipe through restaurant cards built around short-form food-review
video — Tinder for where to eat. **v1** turns the polished v0 placeholder into a
more credible *real-media* prototype: a richer video data model, an honest
status-driven video display, and an internal tool to test attaching real video
sources — still with seeded Washington, DC data and no production database.

> **Strategic note:** the product is *aggregation-first* — restaurant profiles
> are designed to eventually pull together public review content from TikTok,
> Instagram, YouTube and the web. v0 ships with hand-authored seed data and a
> video component that's ready to drop real embeds into. No scraping, no
> creator accounts, no rehosted video.

---

## ✨ What's in v0

| Screen | Route | What it does |
| --- | --- | --- |
| **Onboarding / Landing** | `/` | Brand moment + preference picker (location, distance, budget, cravings, vibe, dietary). Persists to `localStorage`, then → feed. Doubles as the "Tune" settings screen. |
| **Swipe feed** | `/feed` | Full-screen, one-card-at-a-time deck. Drag or tap **Skip / Save**. Cards are ranked by your preferences. |
| **Restaurant profile** | `/restaurants/[id]` | "Creator profile for a restaurant": hero clip, hype metrics, what to order, best-for, source-video carousel, external links. |
| **Saved** | `/saved` | Everything you right-swiped, with a quick unsave + links to profiles. |

**Core experience details**

- **Swipe gestures** — physics-based drag (framer-motion) with rotate, fling,
  and `SAVE` / `SKIP` stamps. Visible buttons too (desktop-friendly), plus
  **← / →** keyboard shortcuts.
- **Ranking** — a simple, transparent weighted score (no fake "AI") in
  [`lib/recommendations.ts`](lib/recommendations.ts) using craving, vibe, budget,
  dietary, distance, trend and freshness. Every card shows an honest
  *"why this matches you."*
- **Legal-safe video** — videos are **never** downloaded or rehosted. Display is
  driven by each clip's `legalDisplayStatus` (see v1 below); attribution is
  always shown and a placeholder is never passed off as a real post.

---

## 🆕 What changed in v1

**1. Richer video data model** ([`lib/types.ts`](lib/types.ts)) — `Video` now
carries `creatorDisplayName?`, `publishedAt?`, `discoveredAt?`, `isRealSource`,
`sourceType` (`real-post` · `creator-profile` · `placeholder` · `manual-seed`),
`matchConfidence` (`high`/`medium`/`low`/`manual`), and `legalDisplayStatus`
(`embeddable` · `source-link-only` · `placeholder-only` · `unavailable`).

**2. Honest, status-driven [`VideoEmbed`](components/VideoEmbed.tsx)** — how a clip renders:

| `legalDisplayStatus` | Renders | External link |
| --- | --- | --- |
| `embeddable` (+ `embedUrl`) | official iframe embed | "View source" |
| `source-link-only` | rich preview card | "View original" (only if `real-post`) / else "View source" |
| `placeholder-only` | rich preview card | **none** — shows a "Source placeholder" chip |
| `unavailable` | muted preview | **none** — shows "Source unavailable" |

Platform + creator credit are always shown. A placeholder is **never** labeled
as a real post, and "View original" appears only for a genuine `real-post`.

**3. Internal video intake tool** — [`/admin/videos`](app/admin/videos/page.tsx)
(client, `noindex`, clearly banner-labeled *internal demo, not public*). Enter a
restaurant + platform + URLs + creator + `sourceType`/`matchConfidence`/
`legalDisplayStatus`, see a **live preview**, and attach it. In v1 this stored
to `localStorage` only; **as of v1.2 attaching persists to a shared backend**
(see the v1.2 section below) so all testers see the clip — localStorage remains
only as a labeled legacy/fallback path.

**4. More credible seed** — captions, creator display names, dates and varied
source types/statuses. Honest by construction: most seed clips are
`placeholder-only`; the linked ones point at **real working YouTube/Google
searches** ("where reviews live"), never a fabricated post URL. `real-post` +
`embeddable` are reserved for the admin tool (paste a genuine URL).

**5. Video-forward UI** — the card gives the clip more room and trims filler
pills; the profile carousel ([`RestaurantVideos`](components/RestaurantVideos.tsx))
shows the source count and merges manual clips.

**6. Ranking** — a small `videoStrength` factor
([`lib/recommendations.ts`](lib/recommendations.ts)) gives a *modest* boost to
restaurants with more / more-credible video coverage. It tilts ties; it doesn't
dominate, and adds no fake precision.

### Legal-safe video rules (still in force)
- Never download, crop, store, or rehost third-party video.
- Always show platform + creator attribution.
- Prefer official embeds / oEmbed / source links over scraping.
- Never imply a placeholder is a real post; "View original" only for `real-post`.

---

## 🔌 v1.1 — real YouTube embeds (backend ingestion slice)

The smallest real-media ingestion path: paste a YouTube URL into the internal
`/admin/videos` tool → it's validated + normalized **server-side** → saved (still
localStorage) → rendered as an actual `youtube-nocookie` embed on the profile.

- **Resolver** ([`lib/youtube.ts`](lib/youtube.ts)) — pure: extracts the 11-char
  video id from `watch?v=`, `youtu.be/ID`, `/shorts/ID`, `/embed/ID` (extra query
  params are fine), builds the canonical `watch?v=ID` + the embed
  `youtube-nocookie.com/embed/ID`, then runs it through `normalizeVideo` →
  `real-post` · `embeddable` · `isRealSource`.
- **Route** ([`app/api/resolve/youtube/route.ts`](app/api/resolve/youtube/route.ts))
  — `POST {url, creatorHandle?, creatorDisplayName?, caption?}` → `{ video }` or
  `{ error }`. Validates server-side; client input is never trusted.
- **No YouTube Data API key** — we don't fetch the title/creator, so we never
  invent them: unknown creator shows **"Unknown creator"**, caption defaults to
  **"YouTube food-review video"**. "View original" links to the canonical watch URL.
- Only allowlisted YouTube hosts can iframe; admin-added videos remain
  **localStorage-only**; nothing is scraped, downloaded, cropped, or rehosted.

**Manual test checklist** (paste into `/admin/videos` → Resolve):

| Input | Expected |
| --- | --- |
| `https://www.youtube.com/watch?v=M7lc1UVf-VE` | resolves → inline embed |
| `https://youtu.be/M7lc1UVf-VE` | resolves → inline embed |
| `https://www.youtube.com/shorts/M7lc1UVf-VE` | resolves → inline embed |
| `https://www.youtube.com/embed/M7lc1UVf-VE` | resolves → inline embed |
| `https://example.com/watch?v=M7lc1UVf-VE` | error — non-YouTube host |
| `not a url` | error — malformed URL |
| `https://www.youtube.com/watch?v=short` | error — invalid video id |

Then **Attach** and open the restaurant profile — the clip plays inline.

---

## 🗄️ v1.2 — shared video persistence (Neon Postgres + Drizzle)

Manually attached/resolved videos now live in a small **shared backend** so every
deployed tester sees the same real-media profiles — not just their own browser.
**Only video attachments are persisted; restaurants stay in
[`lib/seed/restaurants.ts`](lib/seed/restaurants.ts).**

- **Stack** — [Neon](https://neon.tech) Postgres + [Drizzle ORM](https://orm.drizzle.team)
  (HTTP driver, serverless-friendly) via Next route handlers.
- **One table** `restaurant_videos` ([`lib/db/schema.ts`](lib/db/schema.ts)) mirroring
  the `Video` type, plus `status` (`active`/`hidden`), `createdAt`, `updatedAt`.
- **API**
  - `GET /api/restaurants/[id]/videos` — public; validates the seed id, returns
    active persisted videos, each re-normalized through `lib/video`. Degrades
    gracefully (empty list) if the DB is unreachable, so profiles never break.
  - `POST /api/admin/videos` — **admin-secret protected**; validates the seed id,
    runs `normalizeVideo`, inserts. Returns the saved video.
  - `DELETE /api/admin/videos/[id]` — admin-secret protected; **soft-delete** only
    (`status = hidden`).
- **Auth** — minimal, not a real account system: a single shared secret in
  `FOODSWIPE_ADMIN_SECRET`, sent as the `x-foodswipe-admin-secret` header
  (constant-time compared). The admin UI takes it as a session-only input.
- **Display** — `RestaurantVideos` merges **seed + shared (backend) + local
  (legacy localStorage, labeled)** clips; the shared fetch is best-effort.
- The lazy DB client means the app **builds and runs without a database**
  (persisted list is just empty / writes return `503`).

### Environment variables (put them in `.env`, gitignored)

Use **`.env`** (not `.env.local`): Next reads both, but the **drizzle-kit CLI only
auto-loads `.env`**, so this keeps the app and `db:push` on the same value.

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"  # Neon connection string
FOODSWIPE_ADMIN_SECRET="some-long-random-string"                   # gate for admin writes
```

### One-time DB setup

```bash
# 1) Create a Neon project; copy its connection string into .env as DATABASE_URL
# 2) Create the table from the Drizzle schema:
npm run db:push        # drizzle-kit push  (simplest for MVP)
# optional:
npm run db:generate    # emit SQL migration files into ./drizzle
npm run db:studio      # browse the table
```

### ⚠️ Testing note — corporate TLS interception / managed laptops

On a managed/corporate laptop the network may **intercept TLS**. Node uses its
own CA bundle (not the OS trust store), so the Neon HTTP driver's `fetch` — and
`drizzle-kit push` (WebSocket) — can fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
/ `fetch failed`, even when `curl` and the browser work. This is an environment
trust issue, **not** an app bug.

- **Do NOT** disable TLS verification (never set `NODE_TLS_REJECT_UNAUTHORIZED=0`).
- Only if IT provides an **approved corporate root CA**, point Node at it:
  `NODE_EXTRA_CA_CERTS=C:\path\to\corp-ca.pem` for the Node process (the server
  and any `db:*` step). This trusts the same CA the OS already does — it does
  **not** weaken verification.
- Otherwise, prove the Neon round-trip from a **deployment** (e.g. Vercel) or a
  **non-intercepted network** — the HTTP driver connects normally there.
- `npm run db:push` needs a WebSocket / clean network; if it's blocked, run
  `npm run db:generate` and apply `./drizzle/*.sql` where the DB is reachable
  (or let the deploy environment run it).

### v1.2 manual QA checklist

1. Without `DATABASE_URL`: app still builds/runs; profiles show seed videos; the
   admin "Saved for …" list is empty; **Attach → 503** "Database not configured".
2. With `DATABASE_URL` + `FOODSWIPE_ADMIN_SECRET` set and `npm run db:push` done:
   - `/admin/videos`: enter the secret, **Resolve** a YouTube URL (v1.1), **Attach** →
     success; it appears under "Saved for {restaurant}".
   - Open that restaurant's profile (in another browser / incognito) → the clip
     shows and **plays inline** (shared, not per-browser).
   - Wrong/blank secret → Attach returns **401**; bad restaurant id → **400**;
     junk video → **422**.
   - **✕** on a saved row soft-hides it (status `hidden`); it disappears from the
     profile and the list but is not hard-deleted.
3. Seed videos and the v1.1 YouTube resolver still work.

---

## 🧱 Tech stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first `@theme` tokens)
- **framer-motion** — swipe gestures + transitions
- **Neon Postgres + Drizzle ORM** — shared persistence for video attachments (v1.2)
- **localStorage** — client prefs/saves + legacy demo videos. The app still runs
  **without** a database (the persisted list is empty; admin writes return `503`).

Design direction: **dark immersive, video-first** — deep charcoal surfaces,
coral→pink→lime accents, Space Grotesk display type. Built to feel like
short-form video, not like Yelp or a SaaS dashboard.

---

## 🚀 Run it locally

```bash
npm install        # install dependencies
npm run dev        # start the dev server  → http://localhost:3000
```

Other commands:

```bash
npm run build      # production build (also type-checks)
npm run start      # serve the production build
npm run lint       # eslint
```

> 📱 **Best viewed mobile-width.** On desktop the app renders as a centered
> phone-width column — open your browser devtools device toolbar (or just narrow
> the window) for the intended experience.

---

## 📂 Project structure

```
app/
  layout.tsx                 Root layout: fonts, metadata, viewport, ambient bg
  globals.css                Tailwind v4 @theme design tokens + utilities
  page.tsx                   "/"  → onboarding/landing
  feed/page.tsx              "/feed"
  saved/page.tsx             "/saved"
  restaurants/[id]/page.tsx  "/restaurants/[id]" (SSG for all seeded ids)
  restaurants/[id]/not-found.tsx
  admin/videos/page.tsx      "/admin/videos" (internal video intake demo, noindex)
  api/resolve/youtube/route.ts        POST — YouTube URL → embeddable Video (v1.1)
  api/restaurants/[id]/videos/route.ts GET — active persisted videos (v1.2)
  api/admin/videos/route.ts           POST — attach video (admin-secret) (v1.2)
  api/admin/videos/[id]/route.ts      DELETE — soft-delete (admin-secret) (v1.2)

components/
  PreferenceOnboarding.tsx   Landing + preference picker (client)
  FeedClient.tsx             Ranks deck, owns feed state (client)
  SwipeDeck.tsx              Gesture/animation, buttons, empty state (client)
  RestaurantCard.tsx         The swipe card (presentational)
  RestaurantProfile.tsx      Full profile (server-rendered)
  RestaurantVideos.tsx       Profile carousel — seed + shared(DB) + local (client)
  GoThere.tsx                Profile "Go there" links (client)
  SavedClient.tsx            Saved list (client)
  AdminVideos.tsx            Internal intake: resolve + attach to backend (client)
  VideoEmbed.tsx             Legal-safe, status-driven video display
  SaveButton.tsx             Heart toggle on profiles (client)
  TagPill.tsx / MetricBadge.tsx   Presentational primitives
  AppShell.tsx / BottomNav.tsx    Mobile frame + nav

lib/
  types.ts                   Restaurant, Video, ManualVideoEntry, …
  video.ts                   Legal-safe core: normalize/enforce, embed allowlist, gating
  youtube.ts                 YouTube URL resolver (v1.1)
  adminAuth.ts               Admin-secret check for write routes (v1.2)
  options.ts                 Controlled vocab + labels for the onboarding UI
  recommendations.ts         The ranking function (+ videoStrength)
  storage.ts                 localStorage hooks (prefs, swipes, legacy manual videos)
  emoji.ts                   cuisine → emoji for placeholders
  db/schema.ts               Drizzle table: restaurant_videos (v1.2)
  db/index.ts                Lazy Neon/Drizzle client (null without DATABASE_URL)
  db/videos.ts               Persisted video data-access (row ↔ Video)
  seed/restaurants.ts        18 Washington, DC restaurants (the mock dataset)

drizzle.config.ts            drizzle-kit config (db:push / generate / studio)
```

### Architecture notes (so v1 can grow cleanly)

- **`lib/types.ts` is the contract.** The same shapes can back a real DB +
  ingestion pipeline — only the data source changes.
- **Persistence seams:** `lib/storage.ts` (localStorage: prefs/saves/legacy demo)
  and `lib/db/` (Neon/Postgres: shared video attachments, behind the API routes).
- **`VideoEmbed` is the only video seam.** Add an `embedUrl` (e.g.
  `youtube-nocookie`) per video and real embeds light up; everything else is
  unchanged.
- **Ranking is isolated and pure** in `lib/recommendations.ts`, easy to evolve.

---

## 🧠 Assumptions made

- **Greenfield build** — the directory was empty, so the app was scaffolded with
  `create-next-app` (Tailwind v4 + App Router) and follows its conventions.
- **Dependencies:** `framer-motion` (swipe physics) from v0; `drizzle-orm` +
  `@neondatabase/serverless` (+ dev `drizzle-kit`) added in v1.2 for shared
  video persistence — all explicitly in scope for their milestones.
- **Distances are static placeholders** (no geolocation). The brief asked for
  `distanceMiles` as a placeholder.
- **`sourceUrl`s point at the platform/creator**, not at fabricated specific
  posts — honest placeholders for the future aggregation pipeline.
- **Video placeholders are the norm in v0** (no `embedUrl`s seeded) to avoid
  misattributing real creators' content. The embed path is built and ready.
- **Onboarding edits persist live** and the landing also serves as the "Tune"
  screen, so the CTA simply navigates to the feed.

---

## ⚠️ Known limitations (intentional)

- No real data ingestion — all 18 restaurants are hand-authored mock data.
- Seed clips are honest **placeholders** / real **discovery-search** links; no
  real embeds are wired in the seed (the admin tool is how you test a real one).
- Attached videos persist to a **shared Postgres backend** (v1.2, cross-device);
  localStorage demo clips remain only as a labeled legacy/fallback. Both surface
  on **profiles**, not in the feed deck (which keeps a stable hero).
- User **prefs/saves are still `localStorage`-only** — per-browser, no accounts.
- Admin writes are gated by a single shared secret (`FOODSWIPE_ADMIN_SECRET`),
  not a real auth/account system.
- Distance/coords are placeholders; no maps or geolocation.
- Out of scope per brief: scraping, creator/owner accounts, payments,
  reservations, comments, social, full auth, and moving restaurants into the DB.

---

## ✅ Manual QA checklist (v1)

1. `/` — set some preferences (cravings/vibe/budget); they persist on reload.
2. `/feed` — swipe a few cards (drag + buttons + ←/→). Cards show video, tags,
   "why this matches you", and a trend/freshness badge.
3. `/saved` — right-swiped spots appear and persist across reloads; unsave works.
4. `/restaurants/[id]` — open a profile (e.g. **bad-saint**): hero clip, metrics,
   dish list, "best for", and a **Watch the reviews** carousel. Confirm a
   `source-link-only` clip shows **View source** and a `placeholder-only` clip
   shows a **Source placeholder** chip with **no** link — and nothing says
   "View original" for a non-real source.
5. `/admin/videos` — internal banner is visible. Pick a restaurant, fill creator
   + caption, tweak `legalDisplayStatus`, watch the **live preview** change,
   **Attach**, then open that restaurant's profile and see the clip (flagged
   "demo add"). Remove / Clear all work.
6. `npm run lint` and `npm run build` pass.

---

## 🔭 Recommended next steps after v1

1. **Data layer** — move the seed into a DB (Postgres/Prisma or a hosted
   service) behind the same `lib/types.ts` shapes; replace `lib/storage.ts`
   read paths with an API while keeping the hook signatures.
2. **Real embeds + discovery** — wire official **oEmbed** / search APIs to
   populate real `sourceUrl`/`embedUrl` and flip clips to `source-link-only` /
   `embeddable`; `VideoEmbed` already renders them honestly.
3. **Accounts + synced saves** — light auth so saves follow the user across
   devices; persist swipe history server-side to power ranking.
4. **Real distance** — geolocation + a geocoding/maps provider for true
   `distanceMiles` and a "near me" sort.
5. **Smarter ranking** — feed swipe history back into the score (learn from
   skips/saves), add diversity so the deck isn't all one cuisine.
6. **Ingestion pipeline (the core bet)** — the aggregation service that finds and
   attaches public review videos to restaurant profiles, with a moderation/quality
   pass. Creator-submitted content can layer on as a later growth loop.

---

_Prototype only. AI-assisted code — review for accuracy and security before use
in production or company deliverables._
