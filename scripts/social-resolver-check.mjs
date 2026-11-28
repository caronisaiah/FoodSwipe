// Security regression suite for the social-video resolver (lib/socialVideo.ts, lib/youtube.ts, lib/safeFetch.ts).
// Runs the REAL modules in the TypeScript sandbox. The ONLY thing replaced is global `fetch`, with a recording mock:
//  - no real network, no DNS, no private-address connection, no credentials, no database;
//  - every test asserts which requests were (and were NOT) attempted: a refused destination must show up as
//    ABSENT from the request log, i.e. refusal happened BEFORE any request to it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox } from "./lib/ts-sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg); checks++; };

// ---------- recording fetch mock ----------
// routes: Map<url, (init) => Response | Promise<Response>>. An un-routed URL is recorded as UNEXPECTED and throws.
function makeNetwork(routes) {
  const requests = [];
  const fetchMock = async (input, init = {}) => {
    const url = String(input instanceof URL ? input.href : input);
    requests.push({ url, redirect: init.redirect, method: init.method ?? "GET", hasSignal: !!init.signal });
    const handler = routes.get(url) ?? routes.get(url.split("?")[0] + "?*");
    if (!handler) throw new Error(`UNEXPECTED request: ${url}`);
    return handler(init);
  };
  return { requests, fetchMock, urls: () => requests.map((r) => r.url) };
}
const json = (obj, init = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" }, ...init });
const redirect = (location, status = 301) => new Response(null, { status, headers: location === undefined ? {} : { location } });

function load(net, { env = {}, globals = {} } = {}) {
  const sb = createSandbox({ root, env, globals: { fetch: net.fetchMock, ...globals } });
  return { social: sb.load("lib/socialVideo.ts"), video: sb.load("lib/video.ts"), youtube: sb.load("lib/youtube.ts") };
}

const VID = "7203179655342476590";
const CANON = `https://www.tiktok.com/@jyu.eats/video/${VID}`;
const OEMBED = (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`;
const OEMBED_OK = { title: "Best ramen", author_name: "Jyu Eats", author_url: "https://www.tiktok.com/@jyu.eats", thumbnail_url: "https://p16.tiktokcdn.com/x.jpg", html: "<script>alert(1)</script><blockquote>" };

// =====================================================================================================
// 1. Input validation: refused BEFORE any request (the network log must be empty).
// =====================================================================================================
{
  const REJECTED = {
    "http scheme (tiktok)": `http://www.tiktok.com/@a/video/${VID}`,
    "http scheme (youtube)": "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "http scheme (youtu.be)": "http://youtu.be/dQw4w9WgXcQ",
    "http scheme (instagram)": "http://www.instagram.com/p/CuE2WNQs6vH/",
    "ftp scheme": `ftp://www.tiktok.com/@a/video/${VID}`,
    "javascript scheme": "javascript:alert(1)//www.tiktok.com",
    "file scheme": "file:///etc/passwd",
    "data scheme": "data:text/html,<script>1</script>",
    "userinfo user:pass": `https://user:pw@www.tiktok.com/@a/video/${VID}`,
    "userinfo user only": `https://user@www.tiktok.com/@a/video/${VID}`,
    "userinfo host-confusion (evil host after @)": `https://www.tiktok.com@evil.test/@a/video/${VID}`,
    "userinfo (youtube)": "https://u:p@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "non-default port (tiktok)": `https://www.tiktok.com:8443/@a/video/${VID}`,
    "non-default port (short host)": "https://vm.tiktok.com:8080/ZMabc123/",
    "non-default port (instagram)": "https://www.instagram.com:444/p/CuE2WNQs6vH/",
    "non-default port (youtube)": "https://www.youtube.com:81/watch?v=dQw4w9WgXcQ",
    "suffix host tiktok.com.evil.test": `https://tiktok.com.evil.test/@a/video/${VID}`,
    "prefix host evil-tiktok.com": `https://evil-tiktok.com/@a/video/${VID}`,
    "foreign subdomain": `https://foo.tiktok.com/@a/video/${VID}`,
    "www.tiktok.com.evil.test": `https://www.tiktok.com.evil.test/@a/video/${VID}`,
    "short host suffix": "https://vm.tiktok.com.evil.test/ZMabc123/",
    "trailing-dot host": `https://www.tiktok.com./@a/video/${VID}`,
    "other platform host": `https://www.example.com/@a/video/${VID}`,
    "IPv4 literal": `https://127.0.0.1/@a/video/${VID}`,
    "metadata IP literal": "https://169.254.169.254/latest/meta-data/",
    "decimal IPv4": "https://2130706433/",
    "hex IPv4": "https://0x7f000001/",
    "IPv6 loopback literal": "https://[::1]/",
    "localhost": "https://localhost/",
    "backslash host trick": `https://evil.test\\@www.tiktok.com/@a/video/${VID}`,
    "embedded space": `https://www.tiktok.com/@a/video/${VID} x`,
    "embedded newline": `https://www.tiktok.com/@a/video/${VID}\nhttps://evil.test`,
    "embedded tab": `https://www.tiktok.com/@a/\tvideo/${VID}`,
    "NUL byte": `https://www.tiktok.com/@a/video/${VID}\u0000`,
    "no scheme": `www.tiktok.com/@a/video/${VID}`,
    "scheme only": "https://",
    "single-slash scheme": `https:/www.tiktok.com/@a/video/${VID}`,
    "no-slash scheme": `https:www.tiktok.com/@a/video/${VID}`,
    "triple-slash scheme": `https:///www.tiktok.com/@a/video/${VID}`,
    "empty userinfo": `https://@www.tiktok.com/@a/video/${VID}`,
    "empty userinfo + colon": `https://:@www.tiktok.com/@a/video/${VID}`,
    "@ in path-less authority (youtube)": "https://@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "NBSP inside": `https://www.tiktok.com/@a/video/${VID}\u00a0`.replace(/\u00a0$/, "\u00a0x"),
    "NBSP in host": `https://www.tiktok\u00a0.com/@a/video/${VID}`,
    "U+2028 inside": `https://www.tiktok.com/@a/video/${VID}\u2028x`,
    "ideographic space inside": `https://www.tiktok.com/@a/\u3000video/${VID}`,
    "zero-width space in host": `https://www.tiktok\u200b.com/@a/video/${VID}`,
    "zero-width joiner in path": `https://www.tiktok.com/@a/vid\u200deo/${VID}`,
    "bidi override": `https://www.tiktok.com/@a/video/${VID}\u202e`,
    "leading zero-width": `\u200bhttps://www.tiktok.com/@a/video/${VID}`,
    "fullwidth scheme": `ｈｔｔｐｓ://www.tiktok.com/@a/video/${VID}`,
    "tab in scheme": `ht\ttps://www.tiktok.com/@a/video/${VID}`,
    "empty": "",
    "whitespace only": "   ",
    "plain text": "not a url",
    "over-long url": `https://www.tiktok.com/@a/video/${VID}?q=${"a".repeat(2100)}`,
    // path / id shape
    "tiktok id too short": "https://www.tiktok.com/@a/video/12345",
    "tiktok id not numeric": "https://www.tiktok.com/@a/video/abcdefgh",
    "tiktok wrong path word": `https://www.tiktok.com/anything/video/${VID}`,
    "tiktok extra path after id": `https://www.tiktok.com/@a/video/${VID}/extra`,
    "tiktok path before handle": `https://www.tiktok.com/x/@a/video/${VID}`,
    "tiktok profile only": "https://www.tiktok.com/@a",
    "tiktok home": "https://www.tiktok.com/",
    "tiktok oembed path": `https://www.tiktok.com/oembed?url=https://evil.test`,
    "tiktok photo post": `https://www.tiktok.com/@a/photo/${VID}`,
    "short host with video path": `https://vm.tiktok.com/@a/video/${VID}`,
    "short host root": "https://vm.tiktok.com/",
    "short host nested path": "https://vm.tiktok.com/ZMabc/extra/",
    "/t/ without code": "https://www.tiktok.com/t/",
    "instagram profile": "https://www.instagram.com/someuser/",
    "instagram p without code": "https://www.instagram.com/p/",
    "instagram extra path": "https://www.instagram.com/p/CuE2WNQs6vH/extra/path/",
    "instagram explore": "https://www.instagram.com/explore/tags/ramen/",
    "youtube channel": "https://www.youtube.com/@somechannel",
    "youtube bad id": "https://www.youtube.com/watch?v=short",
    "youtube id wrong host": "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "non-string number": 12345,
    "non-string null": null,
    "non-string object": { href: "https://www.tiktok.com/" },
  };
  for (const [name, input] of Object.entries(REJECTED)) {
    const net = makeNetwork(new Map());
    const { social } = load(net);
    const r = await social.resolveSocialVideo(input);
    ok(r.ok === false, `rejects: ${name}`);
    eq(net.urls(), [], `no request attempted for rejected input: ${name}`);
  }
  // The helpers fed a rejected URL return null too (they are called with strings and URL objects).
  const net = makeNetwork(new Map());
  const { social, youtube } = load(net);
  ok(social.extractTikTokId(`http://www.tiktok.com/@a/video/${VID}`) === null, "extractTikTokId refuses http");
  ok(social.extractTikTokId(`https://user@www.tiktok.com/@a/video/${VID}`) === null, "extractTikTokId refuses userinfo");
  ok(social.extractTikTokId(`https://evil.test/@a/video/${VID}`) === null, "extractTikTokId refuses a foreign host");
  ok(social.extractInstagramShortcode("https://evil.test/p/CuE2WNQs6vH/") === null, "extractInstagramShortcode refuses a foreign host");
  ok(social.detectPlatform("http://www.youtube.com/watch?v=dQw4w9WgXcQ") === null, "detectPlatform refuses http");
  ok(youtube.extractYouTubeId("http://youtu.be/dQw4w9WgXcQ") === null, "extractYouTubeId refuses http");
  ok(youtube.extractYouTubeId("https://u:p@youtu.be/dQw4w9WgXcQ") === null, "extractYouTubeId refuses userinfo");
  ok(youtube.extractYouTubeId("https://youtu.be:8443/dQw4w9WgXcQ") === null, "extractYouTubeId refuses a custom port");
  ok(youtube.resolveYouTubeUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ") === null, "resolveYouTubeUrl refuses http");
  eq(net.urls(), [], "helpers make no requests");
}

// =====================================================================================================
// 2. Canonical accepted variants keep working (identity, dedupe key, official embed, attribution).
// =====================================================================================================
{
  const TIKTOK_OK = [
    [`https://www.tiktok.com/@jyu.eats/video/${VID}`, CANON],
    [`https://www.tiktok.com/@jyu.eats/video/${VID}/`, CANON],
    [`https://www.tiktok.com/@jyu.eats/video/${VID}?is_from_webapp=1&sender_device=pc#frag`, CANON],
    [`https://m.tiktok.com/@jyu.eats/video/${VID}`, CANON],
    [`https://tiktok.com/@jyu.eats/video/${VID}`, CANON],
    [`HTTPS://WWW.TikTok.com/@Jyu.Eats/video/${VID}`, CANON],
    [`https://www.tiktok.com:443/@jyu.eats/video/${VID}`, CANON], // explicit DEFAULT port is the same URL
    [`  https://www.tiktok.com/@jyu.eats/video/${VID}  `, CANON], // surrounding whitespace is trimmed
  ];
  for (const [input, canon] of TIKTOK_OK) {
    const net = makeNetwork(new Map([[OEMBED(canon), () => json(OEMBED_OK)]]));
    const { social, video } = load(net);
    const r = await social.resolveSocialVideo(input);
    ok(r.ok, `tiktok accepted: ${input.trim()}`);
    const v = r.resolved;
    eq([v.platform, v.platformVideoId, v.normalizedSourceUrl], ["tiktok", VID, canon], `tiktok identity/dedupe key: ${input.trim()}`);
    ok(v.embedUrl === `https://www.tiktok.com/player/v1/${VID}` && video.isEmbedUrlAllowed(v.embedUrl), "tiktok official player embed");
    eq([v.legalDisplayStatus, v.resolverStatus], ["embeddable", "resolved"], "tiktok resolved + embeddable");
    eq([v.creatorHandle, v.creatorName, v.attributionText, v.caption], ["@jyu.eats", "Jyu Eats", "TikTok post by Jyu Eats", "Best ramen"], "tiktok attribution preserved");
    eq(net.urls(), [OEMBED(canon)], "only the fixed official oEmbed endpoint was requested");
    ok(net.requests[0].redirect === "manual", "oEmbed requested with redirects disabled");
    ok(v.sourceUrl.startsWith("https://"), "sourceUrl (View original) stays the pasted https link");
  }
  // sourceUrl for a pasted canonical link is the pasted link (attribution), not rewritten.
  {
    const input = `https://www.tiktok.com/@jyu.eats/video/${VID}?is_from_webapp=1`;
    const net = makeNetwork(new Map([[OEMBED(CANON), () => json(OEMBED_OK)]]));
    const r = await load(net).social.resolveSocialVideo(input);
    ok(r.resolved.sourceUrl === input, "pasted canonical sourceUrl preserved verbatim");
  }

  const IG_OK = [
    ["https://www.instagram.com/p/CuE2WNQs6vH/", "p", "CuE2WNQs6vH"],
    ["https://www.instagram.com/p/CuE2WNQs6vH", "p", "CuE2WNQs6vH"],
    ["https://instagram.com/p/CuE2WNQs6vH/?igsh=abc", "p", "CuE2WNQs6vH"],
    ["https://m.instagram.com/p/CuE2WNQs6vH/", "p", "CuE2WNQs6vH"],
    ["https://www.instagram.com/reel/Cabc_123-xY/", "reel", "Cabc_123-xY"],
    ["https://www.instagram.com/reels/Cabc_123-xY/", "reel", "Cabc_123-xY"],
    ["https://www.instagram.com/tv/Cabc_123-xY/", "tv", "Cabc_123-xY"],
    ["https://www.instagram.com/some.user/reel/Cabc_123-xY/", "reel", "Cabc_123-xY"],
    ["https://www.instagram.com/some.user/p/CuE2WNQs6vH/", "p", "CuE2WNQs6vH"],
    ["https://www.instagram.com/p/CuE2WNQs6vH/embed", "p", "CuE2WNQs6vH"],
  ];
  for (const [input, kind, code] of IG_OK) {
    const net = makeNetwork(new Map());
    const { social, video } = load(net); // no token: no request at all
    const r = await social.resolveSocialVideo(input);
    ok(r.ok, `instagram accepted: ${input}`);
    const v = r.resolved;
    eq([v.platformVideoId, v.normalizedSourceUrl, v.embedUrl], [code, `https://www.instagram.com/${kind}/${code}/`, `https://www.instagram.com/${kind}/${code}/embed/`], `instagram identity/embed: ${input}`);
    ok(video.isEmbedUrlAllowed(v.embedUrl), "instagram official embed allowed");
    eq([v.resolverStatus, v.legalDisplayStatus], ["missing-credentials", "embeddable"], "instagram without token degrades without a request");
    eq(net.urls(), [], "no token => no request");
  }

  const YT = "dQw4w9WgXcQ";
  const YT_OK = [
    `https://www.youtube.com/watch?v=${YT}`, `https://www.youtube.com/watch?v=${YT}&t=10s`, `https://youtube.com/watch?v=${YT}`,
    `https://m.youtube.com/watch?v=${YT}`, `https://music.youtube.com/watch?v=${YT}`, `https://youtu.be/${YT}`, `https://youtu.be/${YT}?si=abc`,
    `https://www.youtube.com/shorts/${YT}`, `https://www.youtube.com/embed/${YT}`, `https://www.youtube.com/live/${YT}`,
    `https://www.youtube.com/v/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`,
  ];
  for (const input of YT_OK) {
    const net = makeNetwork(new Map());
    const { social, video } = load(net); // no key: no request at all
    const r = await social.resolveSocialVideo(input);
    ok(r.ok, `youtube accepted: ${input}`);
    eq([r.resolved.platformVideoId, r.resolved.normalizedSourceUrl, r.resolved.embedUrl], [YT, `https://www.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`], `youtube identity: ${input}`);
    ok(video.isEmbedUrlAllowed(r.resolved.embedUrl), "youtube nocookie embed allowed");
    eq(net.urls(), [], "no key => no request");
  }
}

// =====================================================================================================
// 3. TikTok short-link expansion: every hop validated BEFORE it is requested.
// =====================================================================================================
const EXPAND = { expandShortLinks: true }; // opt-in: no app route passes this
const SHORT = "https://vm.tiktok.com/ZMabc123/";
const SHORT_REQ = "https://vm.tiktok.com/ZMabc123/"; // what the expander requests (origin + path only)
{
  // 3a. Happy path: one redirect to the canonical video. The canonical page is NEVER requested.
  {
    const net = makeNetwork(new Map([
      [SHORT_REQ, () => redirect(`${CANON}?_r=1&u_code=tracking`)],
      [OEMBED(CANON), () => json(OEMBED_OK)],
    ]));
    const { social } = load(net);
    const r = await social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.ok, "short link expands");
    eq([r.resolved.platformVideoId, r.resolved.normalizedSourceUrl, r.resolved.sourceUrl], [VID, CANON, CANON], "expanded to the canonical id, tracking query stripped");
    eq(r.resolved.embedUrl, `https://www.tiktok.com/player/v1/${VID}`, "expanded link gets the official player embed");
    eq(net.urls(), [SHORT_REQ, OEMBED(CANON)], "requests: the short link, then oEmbed. The canonical page was not fetched");
    ok(net.requests[0].redirect === "manual" && net.requests[0].hasSignal, "short link requested with manual redirects and a deadline signal");
  }
  // 3b. Other approved short shapes.
  for (const [input, reqUrl] of [
    ["https://vt.tiktok.com/ZSxYz9/", "https://vt.tiktok.com/ZSxYz9/"],
    ["https://www.tiktok.com/t/ZTabc12/", "https://www.tiktok.com/t/ZTabc12/"],
    ["https://vm.tiktok.com/ZMabc123", "https://vm.tiktok.com/ZMabc123"],
    ["https://VM.TikTok.com/ZMabc123/?q=1#x", "https://vm.tiktok.com/ZMabc123/"], // query/hash never sent
  ]) {
    const net = makeNetwork(new Map([[reqUrl, () => redirect(CANON)], [OEMBED(CANON), () => json(OEMBED_OK)]]));
    const r = await load(net).social.resolveSocialVideo(input, EXPAND);
    ok(r.ok && r.resolved.platformVideoId === VID, `short form expands: ${input}`);
    eq(net.urls()[0], reqUrl, `exact request for ${input}`);
  }
  // 3c. Location variants that are acceptable: m./bare host canonical, relative path to another short code.
  for (const loc of [`https://m.tiktok.com/@jyu.eats/video/${VID}`, `https://tiktok.com/@jyu.eats/video/${VID}/`]) {
    const net = makeNetwork(new Map([[SHORT_REQ, () => redirect(loc, 302)], [OEMBED(CANON), () => json(OEMBED_OK)]]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.ok && r.resolved.normalizedSourceUrl === CANON, `redirect to ${loc} canonicalizes to www`);
  }
  for (const status of [301, 302, 303, 307, 308]) {
    const net = makeNetwork(new Map([[SHORT_REQ, () => redirect(CANON, status)], [OEMBED(CANON), () => json(OEMBED_OK)]]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.resolved.platformVideoId === VID, `status ${status} is treated as a redirect`);
  }
  {
    const net = makeNetwork(new Map([
      [SHORT_REQ, () => redirect("/ZMother99/")], // relative: resolves against the SAME approved short host
      ["https://vm.tiktok.com/ZMother99/", () => redirect(CANON)],
      [OEMBED(CANON), () => json(OEMBED_OK)],
    ]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.resolved.platformVideoId === VID, "relative redirect to another approved short path is followed");
    eq(net.urls(), [SHORT_REQ, "https://vm.tiktok.com/ZMother99/", OEMBED(CANON)], "two validated hops then oEmbed");
  }
  // 3d. A hop chain of approved hosts (vm -> vt -> canonical).
  {
    const net = makeNetwork(new Map([
      [SHORT_REQ, () => redirect("https://vt.tiktok.com/ZSnext1/")],
      ["https://vt.tiktok.com/ZSnext1/", () => redirect(CANON)],
      [OEMBED(CANON), () => json(OEMBED_OK)],
    ]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.resolved.platformVideoId === VID, "approved multi-hop chain resolves");
  }

  // 3e. REFUSED redirect targets: the target must be absent from the request log (refused BEFORE connecting).
  const DISALLOWED = {
    "other host": "https://evil.test/@a/video/7203179655342476590",
    "suffix host": "https://www.tiktok.com.evil.test/@a/video/7203179655342476590",
    "userinfo host confusion": "https://www.tiktok.com@evil.test/@a/video/7203179655342476590",
    "http (downgrade) canonical": "http://www.tiktok.com/@a/video/7203179655342476590",
    "http (downgrade) short": "http://vm.tiktok.com/ZMabc999/",
    "cloud metadata IP": "http://169.254.169.254/latest/meta-data/",
    "metadata IP over https": "https://169.254.169.254/latest/meta-data/",
    "loopback IPv4": "https://127.0.0.1/admin",
    "loopback IPv6": "https://[::1]/admin",
    "private 10/8": "https://10.0.0.5/",
    "private 192.168/16": "https://192.168.1.1/",
    "private 172.16/12": "https://172.16.0.9/",
    "link-local IPv6": "https://[fe80::1]/",
    "localhost": "https://localhost/",
    "internal name": "https://internal.corp/",
    "decimal-encoded loopback": "https://2130706433/",
    "protocol-relative evil host": "//evil.test/ZMabc123/",
    "custom port on approved host": "https://vm.tiktok.com:8443/ZMabc999/",
    "custom port on web host": `https://www.tiktok.com:8443/@a/video/${VID}`,
    "userinfo on approved host": "https://user:pw@vm.tiktok.com/ZMabc999/",
    "approved host, non-short path": "https://vm.tiktok.com/some/other/path",
    "www login wall": "https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fevil.test",
    "tiktok oembed as target": "https://www.tiktok.com/oembed?url=https://evil.test",
    "unrelated tiktok host": "https://ads.tiktok.com/x",
    "javascript scheme": "javascript:alert(1)",
    "data scheme": "data:text/html,x",
    "file scheme": "file:///etc/passwd",
    "whitespace in location": "https://vm.tiktok.com/ZMabc 999/",
    "backslash host trick": "https://evil.test\\@vm.tiktok.com/ZMabc999/",
    "slash-backslash relative host": "/\\evil.test/x",
    "empty userinfo on approved host": "https://@vm.tiktok.com/ZMabc999/",
    "single-slash scheme": "https:/vm.tiktok.com/ZMabc999/",
    "no-slash scheme": "https:vm.tiktok.com/ZMabc999/",
    "relative without slash": "ZMabc999",
    "NBSP in location": "https://vm.tiktok.com/ZMabc\u00a0999/",
    "zero-width in location": "https://vm.tiktok.com/ZMabc\u200b999/",
    "relative with NBSP": "/ZMabc\u00a0999/",
    "relative with userinfo-ish": "/@evil.test/x",
    "bidi in location": "https://vm.tiktok.com/ZMabc999/\u202e",
  };
  for (const [name, loc] of Object.entries(DISALLOWED)) {
    // (expansion is OFF by default; this block exercises the opt-in path directly)
    const net = makeNetwork(new Map([[SHORT_REQ, () => redirect(loc)], [OEMBED(SHORT.replace(/\/$/, "")), () => json({})]]));
    // The oEmbed fallback for an unexpanded short link targets the fixed official host with the short URL as DATA.
    const { social } = load(net);
    const r = await social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.ok, `fallback keeps the lead reviewable (${name})`);
    eq([r.resolved.platformVideoId, r.resolved.embedUrl, r.resolved.legalDisplayStatus], [null, null, "source-link-only"], `unexpanded short link stays source-link-only (${name})`);
    ok(!net.urls().some((u) => !u.startsWith(SHORT_REQ) && !u.startsWith("https://www.tiktok.com/oembed?url=")), `no request to the refused target (${name}): ${JSON.stringify(net.urls())}`);
    ok(net.urls().filter((u) => !u.startsWith("https://www.tiktok.com/oembed")).length === 1, `only the one validated hop was requested (${name})`);
  }

  // 3f. Loops and over-long chains stop at the cap.
  {
    const A = "https://vm.tiktok.com/AAAA1/", B = "https://vm.tiktok.com/BBBB1/";
    const net = makeNetwork(new Map([[A, () => redirect(B)], [B, () => redirect(A)], [OEMBED(A.replace(/\/$/, "")), () => json({})]]));
    const r = await load(net).social.resolveSocialVideo(A, EXPAND);
    ok(r.ok && r.resolved.platformVideoId === null, "A->B->A loop ends source-link-only");
    eq(net.urls().filter((u) => u.startsWith("https://vm.tiktok.com/")), [A, B], "loop: each hop requested once, never revisited");
  }
  {
    const A = "https://vm.tiktok.com/SELF1/";
    const net = makeNetwork(new Map([[A, () => redirect(A)], [OEMBED(A.replace(/\/$/, "")), () => json({})]]));
    const r = await load(net).social.resolveSocialVideo(A, EXPAND);
    ok(r.ok && r.resolved.platformVideoId === null, "self-redirect ends source-link-only");
    eq(net.urls().filter((u) => u.startsWith("https://vm.tiktok.com/")), [A], "self-redirect requested exactly once");
  }
  {
    const hops = ["https://vm.tiktok.com/H0000/", "https://vm.tiktok.com/H1111/", "https://vm.tiktok.com/H2222/", "https://vm.tiktok.com/H3333/", "https://vm.tiktok.com/H4444/"];
    const routes = new Map(hops.map((h, i) => [h, () => redirect(hops[i + 1] ?? CANON)]));
    routes.set(OEMBED(hops[0].replace(/\/$/, "")), () => json({}));
    const net = makeNetwork(routes);
    const r = await load(net).social.resolveSocialVideo(hops[0], EXPAND);
    ok(r.ok && r.resolved.platformVideoId === null, "chain longer than the cap is not expanded");
    eq(net.urls().filter((u) => u.startsWith("https://vm.tiktok.com/")), hops.slice(0, 3), "max 3 hops requested; hop 4 and 5 never requested");
  }

  // 3g. Non-redirect answers, missing/oversized Location: no canonical, nothing further requested.
  for (const [name, make] of [
    ["200 OK page", () => new Response("<html>login</html>", { status: 200 })],
    ["404", () => new Response(null, { status: 404 })],
    ["500", () => new Response(null, { status: 500 })],
    ["redirect without Location", () => redirect(undefined)],
    ["oversized Location", () => redirect("https://vm.tiktok.com/" + "a".repeat(3000))],
    ["empty Location", () => redirect("")],
  ]) {
    const net = makeNetwork(new Map([[SHORT_REQ, make], [OEMBED(SHORT.replace(/\/$/, "")), () => json({})]]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.ok && r.resolved.platformVideoId === null && r.resolved.legalDisplayStatus === "source-link-only", `fallback source-link-only: ${name}`);
    ok(net.urls().filter((u) => !u.startsWith("https://www.tiktok.com/oembed")).length === 1, `single hop only: ${name}`);
  }
  // 3h. Network error on the hop.
  {
    const net = makeNetwork(new Map([[SHORT_REQ, () => { throw new Error("boom"); }], [OEMBED(SHORT.replace(/\/$/, "")), () => json({})]]));
    const r = await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(r.ok && r.resolved.platformVideoId === null, "network error on a hop falls back to source-link-only");
  }
  // 3i. Deadline: a hop that never answers is aborted (fake timers collapse the 3.5s deadline).
  {
    let aborted = false;
    const net = makeNetwork(new Map([
      [SHORT_REQ, (init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }); })],
      [OEMBED(SHORT.replace(/\/$/, "")), () => json({})],
    ]));
    const fastTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms >= 3000 ? 5 : ms), clearTimeout };
    const r = await load(net, { globals: fastTimers }).social.resolveSocialVideo(SHORT, EXPAND);
    ok(aborted, "the stalled hop was aborted by the single deadline");
    ok(r.ok && r.resolved.platformVideoId === null, "timeout falls back to source-link-only");
  }
  // 3j. Redirect handling is never delegated to fetch.
  {
    const net = makeNetwork(new Map([[SHORT_REQ, () => redirect(CANON)], [OEMBED(CANON), () => json(OEMBED_OK)]]));
    await load(net).social.resolveSocialVideo(SHORT, EXPAND);
    ok(net.requests.every((r) => r.redirect === "manual"), 'every request used redirect:"manual"');
    ok(net.requests.every((r) => r.method === "GET"), "only GET requests");
  }
  // 3k. DEFAULT is off: no options, undefined options, or false => refused with zero requests.
  for (const opts of [undefined, {}, { expandShortLinks: false }, { expandShortLinks: undefined }, { expandShortLinks: "true" }, { expandShortLinks: 1 }]) {
    for (const input of [SHORT, "https://vt.tiktok.com/ZSxYz9/", "https://www.tiktok.com/t/ZTabc12/", "https://m.tiktok.com/t/ZTabc12/", "https://tiktok.com/t/ZTabc12", "HTTPS://VM.TIKTOK.COM/ZMabc123/?x=1"]) {
      const net = makeNetwork(new Map([[SHORT_REQ, () => redirect(CANON)], [OEMBED(CANON), () => json(OEMBED_OK)]]));
      const r = await load(net).social.resolveSocialVideo(input, opts);
      ok(r.ok === false && /full tiktok\.com\/@user\/video\//.test(r.error), `short link refused by default (${JSON.stringify(opts)}): ${input}`);
      eq(net.urls(), [], "default: zero requests (no hop, no oEmbed)");
    }
  }
  {
    // canonical links are unaffected by the switch in either state
    for (const opts of [undefined, { expandShortLinks: false }, EXPAND]) {
      const net = makeNetwork(new Map([[OEMBED(CANON), () => json(OEMBED_OK)]]));
      const r = await load(net).social.resolveSocialVideo(CANON, opts);
      ok(r.ok && r.resolved.platformVideoId === VID, "canonical links resolve regardless of the short-link switch");
    }
  }
}

// =====================================================================================================
// 4. Provider metadata: fixed hosts, no redirects, bounded size/time, safe text.
// =====================================================================================================
{
  const run = async (handler) => {
    const net = makeNetwork(new Map([[OEMBED(CANON), handler]]));
    const r = await load(net).social.resolveSocialVideo(CANON);
    return { r, net };
  };
  // redirect from the official endpoint is NOT followed
  {
    const { r, net } = await run(() => redirect("https://evil.test/steal"));
    eq(net.urls(), [OEMBED(CANON)], "oEmbed redirect not followed (evil target never requested)");
    ok(r.resolved.resolverStatus === "error" && /HTTP 301/.test(r.resolved.resolverError), "oEmbed redirect reported as an error");
    ok(r.resolved.platformVideoId === VID && r.resolved.embedUrl, "identity + embed survive a metadata failure");
  }
  // error statuses
  {
    const { r } = await run(() => new Response("nope", { status: 503 }));
    ok(r.resolved.resolverStatus === "error" && r.resolved.resolverError === "TikTok oEmbed HTTP 503", "HTTP error reported");
  }
  // network failure
  {
    const { r } = await run(() => { throw new Error("socket hang up"); });
    ok(r.resolved.resolverStatus === "error" && r.resolved.resolverError === "TikTok oEmbed request failed", "network failure reported");
  }
  // malformed JSON / wrong JSON shape / HTML
  for (const [name, body] of [["malformed JSON", "{not json"], ["JSON array", "[1,2]"], ["JSON null", "null"], ["HTML page", "<html><script>alert(1)</script></html>"], ["empty body", ""]]) {
    const { r } = await run(() => new Response(body, { status: 200 }));
    ok(r.resolved.resolverStatus === "error" && r.resolved.caption === null, `unparseable metadata rejected: ${name}`);
  }
  // oversized: declared and streamed
  {
    const big = JSON.stringify({ title: "x".repeat(70 * 1024) });
    const { r } = await run(() => new Response(big, { status: 200, headers: { "content-length": String(big.length) } }));
    ok(r.resolved.resolverStatus === "error" && r.resolved.caption === null, "oversized (declared length) metadata rejected");
  }
  {
    const chunk = new TextEncoder().encode("a".repeat(16 * 1024));
    let sent = 0, cancelled = false;
    const stream = new ReadableStream({
      pull(c) { c.enqueue(chunk); sent += chunk.byteLength; },
      cancel() { cancelled = true; },
    });
    const { r } = await run(() => new Response(stream, { status: 200 }));
    ok(r.resolved.resolverStatus === "error", "oversized (streamed, no length header) metadata rejected");
    ok(cancelled && sent <= 8 * 16 * 1024, `stream cancelled at the cap (producer enqueued ${sent} bytes incl. prefetch; bounded, not unlimited)`);
  }
  // hostile / oversized text is stored as plain bounded text, html ignored
  {
    const { r } = await run(() => json({
      title: `<img src=x onerror=alert(1)>\u0000Great‮\nfood ${"y".repeat(5000)}`,
      author_name: "Chef\u0007 <b>Bob</b>​".repeat(40),
      author_url: "https://www.tiktok.com/@chef.bob",
      thumbnail_url: "https://p16.tiktokcdn.com/ok.jpg",
      html: "<script>alert(1)</script>",
    }));
    const v = r.resolved;
    ok(v.caption.length <= 2000 && !/[\u0000-\u0008\u000a-\u001f‮]/.test(v.caption), "caption: control/bidi chars stripped, capped at 2000");
    ok(v.creatorName.length <= 200 && !/\u0007/.test(v.creatorName), "creatorName: control chars stripped, capped at 200");
    ok(!("html" in v) && !JSON.stringify(v).includes("alert(1)</script>"), "provider html field is never carried");
    eq(v.creatorHandle, "@chef.bob", "handle parsed from author_url");
  }
  // thumbnails: only plain https by reference
  for (const [name, thumb, expected] of [
    ["https ok", "https://p16.tiktokcdn.com/ok.jpg", "https://p16.tiktokcdn.com/ok.jpg"],
    ["http", "http://p16.tiktokcdn.com/ok.jpg", null],
    ["javascript", "javascript:alert(1)", null],
    ["data", "data:image/png;base64,AAAA", null],
    ["userinfo", "https://u:p@evil.test/x.jpg", null],
    ["custom port", "https://evil.test:8443/x.jpg", null],
    ["css-breaking chars", "https://evil.test/x.jpg?a=url(x)", null],
    ["not a url", "hello", null],
    ["non-string", 42, null],
  ]) {
    const { r } = await run(() => json({ ...OEMBED_OK, thumbnail_url: thumb }));
    eq(r.resolved.thumbnailUrl, expected, `thumbnail ${name}`);
  }

  // Instagram oEmbed: fixed graph host, redirects not followed, token never forwarded
  {
    const IGU = "https://www.instagram.com/p/CuE2WNQs6vH/";
    const GRAPH = (t) => `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(IGU)}&omitscript=true&access_token=${t}`;
    const net = makeNetwork(new Map([[GRAPH("SYNTHETIC_TOKEN"), () => redirect("https://evil.test/collect")]]));
    const r = await load(net, { env: { INSTAGRAM_OEMBED_TOKEN: "SYNTHETIC_TOKEN" } }).social.resolveSocialVideo(IGU);
    eq(net.urls(), [GRAPH("SYNTHETIC_TOKEN")], "instagram oEmbed redirect not followed; the token goes only to the fixed Graph host");
    ok(r.resolved.resolverStatus === "error" && r.resolved.resolverError === "Instagram oEmbed HTTP 301", "instagram redirect reported");
    ok(!JSON.stringify(r).includes("SYNTHETIC_TOKEN"), "token never appears in the result");
    const ok2 = makeNetwork(new Map([[GRAPH("SYNTHETIC_TOKEN"), () => json({ title: "Nice", author_name: "Pat", thumbnail_url: "https://cdn.test/x.jpg" })]]));
    const r2 = await load(ok2, { env: { INSTAGRAM_OEMBED_TOKEN: "SYNTHETIC_TOKEN" } }).social.resolveSocialVideo(IGU);
    eq([r2.resolved.resolverStatus, r2.resolved.attributionText, r2.resolved.caption], ["resolved", "Instagram post by Pat", "Nice"], "instagram metadata still resolves");
  }

  // YouTube Data API: fixed host, redirect refused, key not forwarded
  {
    const YT = "dQw4w9WgXcQ";
    const API = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${YT}&key=SYNTHETIC_KEY`;
    const net = makeNetwork(new Map([[API, () => redirect("https://evil.test/k")]]));
    const r = await load(net, { env: { YOUTUBE_API_KEY: "SYNTHETIC_KEY" } }).social.resolveSocialVideo(`https://youtu.be/${YT}`);
    eq(net.urls(), [API], "youtube API redirect not followed (key never leaves googleapis.com)");
    ok(r.ok && r.resolved.resolverStatus === "source-link-only" && r.resolved.embedUrl, "youtube falls back to embed-only");
    const okNet = makeNetwork(new Map([[API, () => json({ items: [{ snippet: { title: "Pho", channelTitle: "Hanoi Eats", publishedAt: "2024-01-01T00:00:00Z", thumbnails: { high: { url: "https://i.ytimg.com/vi/x/hq.jpg" } } } }] })]]));
    const r2 = await load(okNet, { env: { YOUTUBE_API_KEY: "SYNTHETIC_KEY" } }).social.resolveSocialVideo(`https://youtu.be/${YT}`);
    eq([r2.resolved.resolverStatus, r2.resolved.creatorName, r2.resolved.caption, r2.resolved.thumbnailUrl], ["resolved", "Hanoi Eats", "Pho", "https://i.ytimg.com/vi/x/hq.jpg"], "youtube metadata still resolves");
  }
}

// =====================================================================================================
// 5. Source guards: nothing in the resolver may follow redirects or fetch an unchecked URL again.
// =====================================================================================================
{
  const src = (f) => readFileSync(resolve(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const social = src("lib/socialVideo.ts"), yt = src("lib/youtube.ts"), safe = src("lib/safeFetch.ts");
  const count = (s, re) => (s.match(re) ?? []).length;
  ok(!/redirect:\s*["']follow["']/.test(social + yt + safe), 'no redirect:"follow" anywhere in the resolver');
  ok(count(social, /\bfetch\(/g) === 1, "socialVideo.ts has exactly one raw fetch (the validated short-link hop)");
  ok(count(yt, /\bfetch\(/g) === 0, "youtube.ts has no raw fetch (uses fetchJsonBounded)");
  ok(count(safe, /\bfetch\(/g) === 1 && /redirect:\s*"manual"/.test(safe), "safeFetch.ts has exactly one fetch and it is manual-redirect");
  ok(/redirect:\s*"manual"/.test(social), "short-link hop is manual-redirect");
  ok(!/protocol\s*===\s*["']http:["']/.test(social + yt), "no code path accepts http:");
}

console.log(`social-resolver-check: ${checks} checks passed`);
