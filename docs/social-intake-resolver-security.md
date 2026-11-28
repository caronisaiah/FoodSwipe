# Social intake: link resolver security

Scope: the admin **social-video intake** path only — `lib/socialVideo.ts`, `lib/youtube.ts`, `lib/safeFetch.ts` and
the four admin routes that call `resolveSocialVideo` (`POST /api/admin/videos/candidates`,
`POST /api/admin/restaurants/[slug]/videos`, `POST …/[slug]/discovery/search`, `POST …/[slug]/discovery/candidates`).
All require a draft or publish credential (`guardAdmin`). Other server fetches in the repo (Google Places, website
evidence, search providers) are out of scope here. Regression suites: `npm run test:social-resolver` (resolver) and
`npm run test:social-intake-routes` (the four routes with the real resolver).

## What is accepted

- **Canonical links only.** TikTok `/@{handle}/video/{6–25 digits}`, Instagram `/{p,reel,reels,tv}/{code}` (optional
  `/{username}/` prefix and `/embed`), YouTube watch / youtu.be / shorts / embed / live / v.
- **TikTok short links (`vm.`/`vt.tiktok.com/{code}`, `tiktok.com/t/{code}`) are NOT supported.** The routes answer
  `422 unsupported_url` asking for the full `tiktok.com/@user/video/{id}` link, with **zero outbound requests and zero
  inserts**. Discovery leads that are short links are marked failed with the same message.
- Short-link expansion exists only behind an internal opt-in (`resolveSocialVideo(url, { expandShortLinks: true })`).
  **No app route sets it.** It is retained, tested, and disabled by default; enabling it would be a deliberate code change
  that needs its own review (see "Not guaranteed").

## Rules (fail closed)

| Area | Rule |
| --- | --- |
| Raw URL grammar | Checked on the raw string before the URL parser: literal `https://` (scheme case-insensitive), no `@` anywhere in the authority (so empty userinfo `https://@host` is refused), no Unicode whitespace/separator, control or format characters (NBSP, U+2028/9, zero-width, bidi), no backslash, ≤ 2048 chars. Then: no non-default port (an explicit `:443` equals the default and is accepted). |
| Hosts | Exact sets, no suffix matching: TikTok `www./m./bare tiktok.com`; Instagram `www./m./bare instagram.com`; YouTube `youtube.com`, `www.`, `m.`, `music.`, `youtu.be`, `youtube-nocookie.com`, `www.youtube-nocookie.com`. |
| Provider calls | Fixed official hosts only (`www.tiktok.com/oembed`, `graph.facebook.com`, `www.googleapis.com`), `redirect: "manual"` (a 3xx is a failure and is never followed, so tokens/keys cannot be forwarded), 4 s deadline, 64 KB response cap (declared and streamed), JSON object required. |
| Output text | Provider text is stored as plain text: control/bidi characters removed, whitespace collapsed, length capped. Provider `html` is never read. Thumbnails are https-only references. |
| Opt-in expansion (internal) | Raw `Location` validated before parsing; every hop validated (exact short-link host and path) before it is requested; ≤ 3 hops; loop detection; one 3.5 s deadline; body cancelled unread; canonical target never requested. |

## Legacy YouTube behaviour (unchanged, stated precisely)

`extractYouTubeId` still accepts, on any allowed YouTube host, a `?v={id}` query on **any path** as a last resort (e.g.
`youtube.com/redirect?v=…`), and takes the first path segment on `youtu.be`. This is intentionally not tightened here
because it cannot widen reach: the id must be exactly 11 `[A-Za-z0-9_-]` characters, the stored URLs are rebuilt from that
id (`youtube.com/watch?v=…`, `youtube-nocookie.com/embed/…`), and the only request made is the fixed Data API call for that id.
It now additionally requires `https://`, no userinfo and the default port.

## Actual guarantee, and what is not guaranteed

- **Guaranteed (verified by mocked tests):** with the default options no request is made for any short link or
  unsupported/malformed/non-HTTPS/userinfo/port/foreign-host input; every outbound request goes to a fixed official hostname
  with redirects disabled and bounded time and size.
- **Not guaranteed:** the resolver does not resolve or pin IP addresses and does not check that provider DNS answers are
  public. A DNS precheck alone would not stop rebinding and `fetch` cannot pin an address without a new dependency or custom
  transport, so none is claimed. Because destination hostnames are fixed in code there is no attacker-controlled DNS to
  rebind; the residual risk is compromise of the provider's own DNS. Enabling opt-in expansion carries the same residual risk.
- **Out of scope / deferred:** IP pinning, an egress proxy, rate limiting and quota infrastructure, and origin/CSRF changes.
  A real TikTok redirect has not been observed (no live calls were made).
