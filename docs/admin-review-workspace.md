# Restaurant review workspace

Admin Hardening C. One page per restaurant candidate, `/admin/restaurants/candidates/[id]` (the stable database id), brings everything needed to review a restaurant together so it can be taken from an imported draft to a published profile without moving between pages. Every candidate link in the admin API (`adminUrl`, and `restaurantReviewUrl` on video leads) points here. The candidate list (`/admin/restaurants/candidates`, which still accepts `?candidate=<id>`), the video queue and the published-video screen remain.

## What is on the page
| Section | What it does |
|---|---|
| Identity | Name, address, market, neighborhood, website, coordinates, Google Place ID, source freshness, website evidence and duplicate / Place ID warnings. Edits use `PATCH /api/admin/restaurants/candidates/[id]` and send only the fields you changed. |
| Details | Price, cuisine, vibe, best-for, dietary, dishes, public description, review notes. The controlled vocabulary is enforced by the same PATCH. Tags the automatic tagger suggested are labelled as unconfirmed suggestions. |
| Photography | The stored hero selection (from our database). The existing Google photo workflow is behind two buttons, because Places lookups are billable. Photos stay on Google with their attribution; only the selected photo number is stored. |
| Creator videos | Every video lead tied to the restaurant, including unpublished ones and ones linked only by a typed slug. Each shows platform, creator, attribution, the original link, the legal display classification, the notes whoever queued it wrote, and five separate evidence stages. An official embed loads only when you press Load player, one at a time. |
| Map readiness | Read-only: coordinates, market and whether an independently reviewed map location is approved. Publishing a restaurant does not create a map point. |
| Publication checklist | Complete / missing / invalid / needs a person, computed on the server from the same rules promotion enforces. |
| Audit history | Recent events for the restaurant and its video leads (publication credential only). |

## Human approval boundaries
- Opening the page only reads. It never approves, promotes, attaches or changes anything, and saving one field never triggers another action.
- Four separate steps, each a button followed by a confirmation: approve the restaurant (marks it reviewed, does not publish), promote it to the live feed, approve a video lead, attach an approved video to a published restaurant.
- Promotion warnings (no Place ID, likely duplicate, pin far from the market) need a written reason of at least 10 characters and an acknowledgement; both are stored on the audit event.
- Evidence stages: "URL discovered" and "Metadata verified" are facts the system established. "Restaurant visually identified" and "Video content reviewed by a human" are only ever shown as **declared by a reviewer** (the tick boxes at approval are stored as the audit reason under the credential used) or as **not recorded**. The audit log names a shared credential, not a person, and nothing checks audio, sponsorship or which branch a video shows.

## Authorization
`GET /api/admin/restaurants/candidates/[id]/review` is read-only and accepts the draft or the publication credential. The draft credential receives no audit history. Approve, reject, promote, attach, hero selection and the audit history need the publication credential, enforced by the server (the screen only greys the controls out). The admin secret is held in component memory only: it is never written to browser storage, a cookie or the URL.

## Known limits
- Creator fields and captions of a lead are edited in the video queue, not here.
- Linking legacy slug-only leads to their draft by id is a per-lead confirmed action (or the audited mapping script); the page never does it automatically.
- Google photo lookups need `GOOGLE_MAPS_API_KEY`; without it the photo panel reports that.
- No database migration is involved.

## Local QA
`QA_PUBLISH_SECRET=... QA_DRAFT_SECRET=... node docs/qa/admin-hardening-c/qa-server.mjs` serves the real route handlers on in-memory PostgreSQL with synthetic data (no production access). Run `next dev` and redirect the page's `/api/admin/*` calls to it.
