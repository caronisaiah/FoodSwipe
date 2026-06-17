@AGENTS.md

# FoodSwipe

Swipe-based restaurant discovery through short-form food-review videos — TikTok
food discovery + dating-app decision energy + local restaurant personality.

**Strategy: aggregation-first.** Profiles eventually pull public review content
from TikTok / Instagram / YouTube / web. Creator-submitted content is a possible
*later* loop, never the core dependency.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 (CSS-first
`@theme` in `app/globals.css`) · framer-motion · localStorage persistence ·
seeded Washington, DC data. Routes: `/`, `/feed`, `/saved`, `/restaurants/[id]`.

## Architecture seams — preserve these
- `lib/types.ts` — the data contract. Same shapes back a real DB/ingestion later.
- `lib/storage.ts` — the only persistence seam (localStorage now → API later).
- `components/VideoEmbed.tsx` — the only video-display seam. Add `embedUrl` for
  real oEmbed/iframe; placeholder otherwise. Callers never change.
- `lib/recommendations.ts` — owns ranking. Keep it a simple, readable, honest
  weighted score.
Seed data lives in `lib/seed/restaurants.ts`.

## Product principles
- Video is the emotional center. Mobile-first, fast, fun, crave-driven, shareable.
- Do NOT look like a generic AI/SaaS dashboard or Yelp.
- No faked intelligence/precision; no "AI" claims without a real feature.
- Video is legal-safe: never download/crop/store/rehost third-party video; always
  show platform + creator attribution + a "View original" link; prefer official
  embeds/oEmbed/source links over scraping.

## Out of scope (don't build unless explicitly asked)
auth · database · scraping/crawling · payments · reservations · comments · social
following · creator/restaurant-owner dashboards · a full recommendation engine.

## Engineering rules
- Inspect the repo before changing files; explain the plan before major
  architectural changes; make small, reviewable changes.
- Don't add major dependencies without explaining why.
- End every implementation pass with `npm run lint` and `npm run build`.
- Report: commands passed/failed, files changed, assumptions, remaining risks.

## Workflow for major tasks
1. Explore the repo. 2. Restate the relevant architecture. 3. Propose a plan.
4. Ask for clarification only if the ambiguity affects architecture/product
direction. 5. Implement the smallest useful vertical slice. 6. Validate with
lint + build. 7. Summarize changes and next steps.
