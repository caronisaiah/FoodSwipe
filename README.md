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
`legalDisplayStatus`, see a **live preview**, and attach it. Stored in
`localStorage` (key `foodswipe.manualVideos.v1`) via
[`useManualVideos`](lib/storage.ts) — no server/db. Added clips appear on that
restaurant's profile (flagged "demo add") for the session.

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

## 🧱 Tech stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first `@theme` tokens)
- **framer-motion** — the one added dependency, for swipe gestures + transitions
- **localStorage** for persistence (no DB, no auth, no API keys)

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

components/
  PreferenceOnboarding.tsx   Landing + preference picker (client)
  FeedClient.tsx             Ranks deck, owns feed state (client)
  SwipeDeck.tsx              Gesture/animation, buttons, empty state (client)
  RestaurantCard.tsx         The swipe card (presentational)
  RestaurantProfile.tsx      Full profile (server-rendered)
  RestaurantVideos.tsx       Profile video carousel — seed + manual (client)
  SavedClient.tsx            Saved list (client)
  AdminVideos.tsx            Internal video intake form + live preview (client)
  VideoEmbed.tsx             Legal-safe, status-driven video display
  SaveButton.tsx             Heart toggle on profiles (client)
  TagPill.tsx / MetricBadge.tsx   Presentational primitives
  AppShell.tsx / BottomNav.tsx    Mobile frame + nav

lib/
  types.ts                   Restaurant, Video (v1 fields), ManualVideoEntry, …
  options.ts                 Controlled vocab + labels for the onboarding UI
  recommendations.ts         The ranking function (+ videoStrength)
  storage.ts                 localStorage hooks (prefs, swipes, manual videos)
  emoji.ts                   cuisine → emoji for placeholders
  seed/restaurants.ts        18 Washington, DC restaurants (the mock dataset)
```

### Architecture notes (so v1 can grow cleanly)

- **`lib/types.ts` is the contract.** The same shapes can back a real DB +
  ingestion pipeline — only the data source changes.
- **`lib/storage.ts` is the only persistence seam.** Swap these hooks for an API
  client and the screens don't change.
- **`VideoEmbed` is the only video seam.** Add an `embedUrl` (e.g.
  `youtube-nocookie`) per video and real embeds light up; everything else is
  unchanged.
- **Ranking is isolated and pure** in `lib/recommendations.ts`, easy to evolve.

---

## 🧠 Assumptions made

- **Greenfield build** — the directory was empty, so the app was scaffolded with
  `create-next-app` (Tailwind v4 + App Router) and follows its conventions.
- **framer-motion was added** as the single extra dependency; hand-rolling
  physics swiping would be more code and a worse feel.
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
- Manually-added videos (`/admin/videos`) live in `localStorage` for the
  current browser/session only — no server, no cross-device sync, and they
  surface on **profiles**, not in the feed deck (which keeps a stable hero).
- Persistence is `localStorage` only — per-browser, no accounts.
- Distance/coords are placeholders; no maps or geolocation.
- Out of scope per brief: scraping, creator/owner accounts, payments,
  reservations, comments, social, full auth, and a production database.

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
