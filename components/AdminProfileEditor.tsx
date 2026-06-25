"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isEmbedUrlAllowed } from "@/lib/video";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Internal RESTAURANT PROFILE EDITOR — NOT a public feature.

  Pick a restaurant (slug typeahead), then edit its tags and add/remove its videos
  in one place. Seed restaurants are code-managed (tags shown read-only); published
  DB restaurants are fully editable. Adding a video resolves the URL through the
  same official resolver + legal-safe path and attaches it directly (the admin is
  the reviewer). Secret-gated; types mirrored locally so no DB runtime bundles in.

  This sits ALONGSIDE the review queue (/admin/videos/candidates) — that stays the
  review-first intake for discovered/imported videos.
*/

const VOCAB_HINT = {
  cuisine: "e.g. mexican, tacos, ramen, italian, pizza, bakery, coffee",
  dietary: "vegan, vegetarian, halal, gluten-free, no pork",
  vibe: "quick bite, date night, group dinner, late night, casual, hidden gem",
  bestFor: "quick bite, date night, group dinner, late night, casual",
  dish: 'short dishes, e.g. "Tacos", "Ramen"',
};

interface RestaurantLite {
  id: string; // public slug
  name: string;
  neighborhood: string;
  priceLevel: number;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  bestFor: string[];
  dishHighlights: string[];
  reasonText: string;
}

interface PublishedAdmin {
  id: string; // uuid (PATCH addressing)
  slug: string;
  status: string;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  bestFor: string[];
  dishHighlights: string[];
  reasonText: string;
}

interface VideoLite {
  id: string;
  platform: string;
  creatorHandle: string;
  creatorDisplayName?: string | null;
  caption: string;
  sourceUrl?: string | null;
  embedUrl?: string | null;
  legalDisplayStatus: string;
  sourceType?: string;
}

/** A generated discovery query (mirrors lib/discovery/queryGenerator). */
interface GeneratedQuery {
  key: string;
  query: string;
  platform: string;
  queryType: string;
  reason: string;
  searchUrl: string;
  warnings?: string[];
}

/** A dry-run search lead (mirrors lib/discovery/normalizeSearchResults). */
interface DiscoveryLeadLite {
  key: string;
  title: string;
  url: string;
  snippet: string;
  query: string;
  detectedPlatform: string | null;
  resolverStatus: string;
  resolverError?: string;
  embedUrl?: string | null;
  legalDisplayStatus?: string | null;
  matchConfidence?: number;
  matchReasons?: string[];
}
interface DiscoveryStats {
  rawResults: number;
  socialResults: number;
  resolved: number;
  failed: number;
  duplicatesSkipped: number;
  failedQueries: number;
}

type Msg = { type: "ok" | "err"; text: string } | null;

function parseList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}
function priceLabel(level: number): string {
  return level >= 1 && level <= 4 ? "$".repeat(level) : "—";
}

export default function AdminProfileEditor() {
  const [secret, setSecret] = useState("");
  const [options, setOptions] = useState<RestaurantLite[]>([]);
  const [publishedBySlug, setPublishedBySlug] = useState<Map<string, PublishedAdmin>>(new Map());
  const [publishedLoaded, setPublishedLoaded] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [topMsg, setTopMsg] = useState<Msg>(null);

  // Picker
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Public merged list (seed + published) for the picker + seed tag display.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/restaurants");
        const data = (await res.json()) as { restaurants?: RestaurantLite[] };
        if (!cancelled && Array.isArray(data.restaurants)) {
          setOptions(
            data.restaurants
              .map((r) => ({
                id: r.id,
                name: r.name,
                neighborhood: r.neighborhood ?? "",
                priceLevel: r.priceLevel,
                cuisineTags: r.cuisineTags ?? [],
                dietaryTags: r.dietaryTags ?? [],
                vibeTags: r.vibeTags ?? [],
                bestFor: r.bestFor ?? [],
                dishHighlights: r.dishHighlights ?? [],
                reasonText: r.reasonText ?? "",
              }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      } catch {
        // picker just won't populate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensurePublishedLoaded() {
    if (publishedLoaded || !secret.trim()) return;
    try {
      const res = await fetch("/api/admin/restaurants/published", {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { restaurants?: PublishedAdmin[]; error?: string };
      if (res.ok && Array.isArray(data.restaurants)) {
        setPublishedBySlug(new Map(data.restaurants.map((r) => [r.slug, r])));
        setPublishedLoaded(true);
      } else if (!res.ok) {
        setTopMsg({ type: "err", text: data.error ?? "Could not load published restaurants (check the secret)." });
      }
    } catch {
      setTopMsg({ type: "err", text: "Network error loading published restaurants." });
    }
  }

  async function pick(slug: string) {
    setQuery("");
    setOpen(false);
    setTopMsg(null);
    // Load the published-admin map first so the panel renders with editable tags
    // immediately (no brief "seed/read-only" flash for a published restaurant).
    await ensurePublishedLoaded();
    setSelectedSlug(slug);
  }

  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? options.slice(0, 10)
      : options.filter((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)).slice(0, 10);

  const selected = selectedSlug ? options.find((o) => o.id === selectedSlug) ?? null : null;
  const published = selectedSlug ? publishedBySlug.get(selectedSlug) ?? null : null;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 rounded-xl border border-saffron/30 bg-saffron/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-saffron">
          <MaterialIcon name="edit_note" className="text-sm" />
          Restaurant profile editor
        </p>
        <p className="mt-0.5 text-cream/80">
          Edit a live restaurant&apos;s tags and add/remove its videos. Seed restaurants
          are code-managed (tags read-only); published DB restaurants are fully editable.
          Added videos use the official resolver + legal-safe path — no downloads/rehosting.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">Profile editor</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/admin/videos/candidates" className="text-haze underline-offset-2 hover:underline">
            Review queue
          </Link>
          <Link href="/admin/restaurants/published" className="text-haze underline-offset-2 hover:underline">
            Published
          </Link>
        </div>
      </header>

      <div className="mb-4">
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-cream">Admin secret</span>
            <span className="text-[10px] text-haze">session only — not stored</span>
          </span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="FOODSWIPE_ADMIN_SECRET"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
          />
        </label>
      </div>

      {/* Restaurant picker */}
      <div className="relative mb-4">
        <span className="mb-1 block text-xs font-semibold text-cream">Restaurant</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={selected ? `${selected.name} · /${selected.id}` : "type a name or slug to search"}
          aria-label="Restaurant"
          autoComplete="off"
          className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
        />
        {open && matches.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-surface-2 py-1 shadow-xl ring-1 ring-inset ring-white/15">
            {matches.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(o.id)}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-white/10"
                >
                  <span className="truncate text-cream">{o.name}</span>
                  {o.neighborhood && <span className="shrink-0 truncate text-haze">{o.neighborhood}</span>}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-haze">/{o.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {topMsg && (
        <p className={`mb-2 text-xs ${topMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{topMsg.text}</p>
      )}

      {!selected ? (
        <p className="text-sm text-haze">Enter the admin secret and pick a restaurant to edit.</p>
      ) : (
        <ProfilePanel
          key={selected.id}
          restaurant={selected}
          published={published}
          secret={secret}
          onPublishedSaved={(updated) =>
            setPublishedBySlug((m) => new Map(m).set(updated.slug, updated))
          }
          priceLabelFn={priceLabel}
        />
      )}
    </div>
  );
}

function ProfilePanel({
  restaurant,
  published,
  secret,
  onPublishedSaved,
  priceLabelFn,
}: {
  restaurant: RestaurantLite;
  published: PublishedAdmin | null;
  secret: string;
  onPublishedSaved: (updated: PublishedAdmin) => void;
  priceLabelFn: (n: number) => string;
}) {
  const editable = published !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-cream">{restaurant.name}</p>
          <p className="truncate text-[11px] text-haze">
            {restaurant.neighborhood ? `${restaurant.neighborhood} · ` : ""}/{restaurant.id} ·{" "}
            {priceLabelFn(restaurant.priceLevel)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
            editable ? "bg-mint/15 text-mint ring-mint/30" : "bg-white/10 text-haze ring-white/15"
          }`}
        >
          {editable ? `published · ${published?.status}` : "seed (code-managed)"}
        </span>
        <a
          href={`/restaurants/${restaurant.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
        >
          View
        </a>
      </div>

      {editable && published ? (
        <TagEditor published={published} secret={secret} onSaved={onPublishedSaved} />
      ) : (
        <ReadOnlyTags restaurant={restaurant} />
      )}

      <VideosPanel slug={restaurant.id} secret={secret} />

      <FindVideosPanel slug={restaurant.id} secret={secret} />
    </div>
  );
}

/* ----- discovery: deterministic search-query leads (Slice 1, no external API) ----- */

function FindVideosPanel({ slug, secret }: { slug: string; secret: string }) {
  const [queries, setQueries] = useState<GeneratedQuery[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Slice 2: provider-backed dry-run search.
  const [leads, setLeads] = useState<DiscoveryLeadLite[] | null>(null);
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function runDrySearch() {
    if (searching) return;
    if (!secret.trim()) {
      setSearchError("Enter the admin secret first.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/discovery/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({}), // defaults: generated queries, capped, resolve=true
      });
      const data = (await res.json()) as { leads?: DiscoveryLeadLite[]; stats?: DiscoveryStats; error?: string };
      if (!res.ok) {
        setLeads(null);
        setStats(null);
        setSearchError(data.error ?? `Search failed (${res.status}).`);
        return;
      }
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setStats(data.stats ?? null);
    } catch {
      setSearchError("Network error running search.");
    } finally {
      setSearching(false);
    }
  }

  async function findVideos() {
    if (loading) return;
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/discovery/queries`, {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { queries?: GeneratedQuery[]; error?: string };
      if (!res.ok) {
        setQueries(null);
        setError(data.error ?? `Failed (${res.status}).`);
        return;
      }
      setQueries(Array.isArray(data.queries) ? data.queries : []);
    } catch {
      setError("Network error generating queries.");
    } finally {
      setLoading(false);
    }
  }

  async function copy(q: GeneratedQuery) {
    try {
      await navigator.clipboard.writeText(q.query);
      setCopiedKey(q.key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      // clipboard blocked — the text is still visible/selectable
    }
  }

  // De-duplicated name-level cautions across all queries.
  const bannerWarnings = queries
    ? Array.from(new Set(queries.flatMap((q) => q.warnings ?? [])))
    : [];

  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
          <MaterialIcon name="search" className="text-sm" />
          Find videos
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void findVideos()}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
          >
            <MaterialIcon name="search" className="text-sm" />
            {loading ? "Generating…" : queries ? "Regenerate" : "Find videos"}
          </button>
          <button
            type="button"
            onClick={() => void runDrySearch()}
            disabled={searching}
            className="flex items-center gap-1 rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
          >
            <MaterialIcon name="travel_explore" className="text-sm" />
            {searching ? "Searching…" : "Run dry search"}
          </button>
        </div>
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-haze">
        Manual search leads only — opening a query searches the web in a new tab. No
        videos are imported or attached until you paste a URL into Add by URL above
        or approve it in the review queue.
      </p>

      {error && <p className="mb-2 text-xs text-chili-soft">{error}</p>}

      {bannerWarnings.length > 0 && (
        <div className="mb-2 rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/20">
          {bannerWarnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1">
              <MaterialIcon name="warning" className="mt-px text-[12px]" />
              {w}
            </p>
          ))}
        </div>
      )}

      {queries && queries.length === 0 && !error && (
        <p className="text-sm text-haze">No queries generated.</p>
      )}

      {queries && queries.length > 0 && (
        <ul className="space-y-1.5">
          {queries.map((q) => (
            <li key={q.key} className="rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-tan ring-1 ring-inset ring-white/15">
                  {q.platform}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-haze">{q.queryType}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(q)}
                    aria-label="Copy query"
                    className="rounded-md p-1 text-haze hover:bg-white/10 hover:text-cream"
                  >
                    <MaterialIcon name={copiedKey === q.key ? "check" : "content_copy"} className="text-sm" />
                  </button>
                  <a
                    href={q.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
                  >
                    <MaterialIcon name="open_in_new" className="text-[12px]" />
                    Run
                  </a>
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-cream">{q.query}</p>
              <p className="text-[10px] text-haze">{q.reason}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Slice 2: dry-run search results */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-1.5 flex items-start gap-1 text-[10px] leading-relaxed text-saffron">
          <MaterialIcon name="payments" className="mt-px text-[12px]" />
          Dry run calls Brave Search and resolves public social URLs. It does not
          create candidates or attach videos.
        </p>
        {searchError && <p className="mb-2 text-xs text-chili-soft">{searchError}</p>}
        {stats && (
          <p className="mb-2 text-[10px] text-haze">
            {leads?.length ?? 0} leads · {stats.socialResults} social / {stats.rawResults} raw · resolved{" "}
            {stats.resolved}, failed {stats.failed}, dupes {stats.duplicatesSkipped}
            {stats.failedQueries > 0 ? ` · ${stats.failedQueries} query error(s)` : ""}
          </p>
        )}
        {leads && leads.length === 0 && !searchError && (
          <p className="text-sm text-haze">No social leads found for these queries.</p>
        )}
        {leads && leads.length > 0 && (
          <ul className="space-y-1.5">
            {leads.map((lead) => {
              const conf = lead.matchConfidence ?? 0;
              const tone = conf >= 60 ? "text-mint" : conf >= 30 ? "text-saffron" : "text-haze";
              return (
                <li
                  key={lead.key}
                  className={`rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5 ${conf < 25 ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-tan ring-1 ring-inset ring-white/15">
                      {lead.detectedPlatform ?? "?"}
                    </span>
                    <span className={`shrink-0 font-display text-xs font-bold ${tone}`}>{conf}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-haze">
                      {lead.resolverStatus === "resolved" ? (
                        <span className="flex items-center gap-0.5 text-mint">
                          <MaterialIcon name="play_circle" className="text-[11px]" /> embeddable
                        </span>
                      ) : lead.resolverStatus === "failed" ? (
                        <span className="text-chili-soft">resolve failed</span>
                      ) : (
                        <span>{lead.resolverStatus}</span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-cream">{lead.title || "(no title)"}</p>
                  {lead.snippet && <p className="line-clamp-2 text-[11px] text-haze">{lead.snippet}</p>}
                  <a
                    href={lead.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-saffron underline-offset-2 hover:underline"
                  >
                    <MaterialIcon name="open_in_new" className="shrink-0 text-[12px]" />
                    <span className="truncate">{lead.url}</span>
                  </a>
                  {lead.matchReasons && lead.matchReasons.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-haze">{lead.matchReasons.join(" · ")}</p>
                  )}
                  {lead.resolverError && (
                    <p className="text-[10px] text-chili-soft">{lead.resolverError}</p>
                  )}
                  <p className="text-[9px] text-haze/70">found by: {lead.query}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function TagEditor({
  published,
  secret,
  onSaved,
}: {
  published: PublishedAdmin;
  secret: string;
  onSaved: (updated: PublishedAdmin) => void;
}) {
  const [cuisine, setCuisine] = useState(published.cuisineTags.join(", "));
  const [dietary, setDietary] = useState(published.dietaryTags.join(", "));
  const [vibe, setVibe] = useState(published.vibeTags.join(", "));
  const [bestFor, setBestFor] = useState(published.bestFor.join(", "));
  const [dishes, setDishes] = useState(published.dishHighlights.join(", "));
  const [reasonText, setReasonText] = useState(published.reasonText);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save() {
    if (saving) return;
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/published/${published.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({
          cuisineTags: parseList(cuisine),
          dietaryTags: parseList(dietary),
          vibeTags: parseList(vibe),
          bestFor: parseList(bestFor),
          dishHighlights: parseList(dishes),
          reasonText,
        }),
      });
      const data = (await res.json()) as { restaurant?: PublishedAdmin; error?: string };
      if (!res.ok || !data.restaurant) {
        setMsg({ type: "err", text: data.error ?? `Save failed (${res.status}).` });
        return;
      }
      setMsg({ type: "ok", text: "Saved." });
      onSaved(data.restaurant);
    } catch {
      setMsg({ type: "err", text: "Network error saving tags." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-haze">Tags &amp; copy</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TagField label="Cuisine" hint={VOCAB_HINT.cuisine} value={cuisine} onChange={setCuisine} />
        <TagField label="Dietary" hint={VOCAB_HINT.dietary} value={dietary} onChange={setDietary} />
        <TagField label="Vibe" hint={VOCAB_HINT.vibe} value={vibe} onChange={setVibe} />
        <TagField label="Best for" hint={VOCAB_HINT.bestFor} value={bestFor} onChange={setBestFor} />
      </div>
      <div className="mt-2.5">
        <TagField label="Dish highlights" hint={VOCAB_HINT.dish} value={dishes} onChange={setDishes} />
      </div>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-xs font-semibold text-cream">Reason text</span>
        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
        />
      </label>
      <p className="mt-1 text-[10px] text-haze">Tags outside the controlled vocab are dropped on save (not an error).</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save tags"}
        </button>
        {msg && <span className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}

function ReadOnlyTags({ restaurant }: { restaurant: RestaurantLite }) {
  const groups: { label: string; items: string[] }[] = [
    { label: "Cuisine", items: restaurant.cuisineTags },
    { label: "Dietary", items: restaurant.dietaryTags },
    { label: "Vibe", items: restaurant.vibeTags },
    { label: "Best for", items: restaurant.bestFor },
    { label: "Dishes", items: restaurant.dishHighlights },
  ];
  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
        <MaterialIcon name="lock" className="text-sm" />
        Tags (seed — read-only)
      </p>
      <div className="space-y-1.5">
        {groups.map((g) => (
          <div key={g.label} className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 text-[11px] text-haze">{g.label}</span>
            <div className="flex flex-wrap gap-1">
              {g.items.length > 0 ? (
                g.items.map((t, i) => (
                  <span key={`${t}-${i}`} className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-tan">
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-haze">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-haze">
        This is a seed restaurant — its tags are managed in code (lib/seed/restaurants.ts). Videos below are still editable.
      </p>
    </section>
  );
}

function VideosPanel({ slug, secret }: { slug: string; secret: string }) {
  const [videos, setVideos] = useState<VideoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const seq = useRef(0);

  // Reloader for event handlers (add/remove). setState only after the await.
  async function fetchVideos() {
    const s = ++seq.current;
    try {
      const res = await fetch(`/api/restaurants/${slug}/videos`);
      const data = (await res.json()) as { videos?: VideoLite[] };
      if (s !== seq.current) return;
      setVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch {
      if (s === seq.current) setVideos([]);
    } finally {
      if (s === seq.current) setLoading(false);
    }
  }

  // Load on mount (the panel remounts per restaurant via the parent key). setState
  // happens only in the async continuation — never synchronously in the effect.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${slug}/videos`);
        const data = (await res.json()) as { videos?: VideoLite[] };
        if (cancelled) return;
        setVideos(Array.isArray(data.videos) ? data.videos : []);
      } catch {
        if (!cancelled) setVideos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function addVideo() {
    if (adding) return;
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    if (!addUrl.trim()) {
      setMsg({ type: "err", text: "Paste a TikTok / Instagram / YouTube URL." });
      return;
    }
    setAdding(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/${slug}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({ sourceUrl: addUrl.trim() }),
      });
      const data = (await res.json()) as { video?: VideoLite; error?: string };
      if (!res.ok || !data.video) {
        setMsg({ type: "err", text: data.error ?? `Add failed (${res.status}).` });
        return;
      }
      setMsg({ type: "ok", text: "Video added to this profile." });
      setAddUrl("");
      await fetchVideos();
    } catch {
      setMsg({ type: "err", text: "Network error adding video." });
    } finally {
      setAdding(false);
    }
  }

  async function removeVideo(id: string) {
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    try {
      const res = await fetch(`/api/admin/videos/${id}`, {
        method: "DELETE",
        headers: { "x-foodswipe-admin-secret": secret },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg({ type: "err", text: d.error ?? "Remove failed." });
        return;
      }
      setVideos((vs) => vs.filter((v) => v.id !== id));
      setMsg({ type: "ok", text: "Video removed." });
    } catch {
      setMsg({ type: "err", text: "Network error removing video." });
    }
  }

  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
        <MaterialIcon name="movie" className="text-sm" />
        Videos ({videos.length})
      </p>

      {/* Add */}
      <div className="mb-3 flex gap-2">
        <input
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addVideo();
          }}
          placeholder="add by URL — TikTok / Instagram / YouTube"
          aria-label="Add video URL"
          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
        />
        <button
          type="button"
          onClick={() => void addVideo()}
          disabled={adding}
          className="shrink-0 rounded-lg bg-brand-gradient px-3 py-2 text-sm font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>
      {msg && <p className={`mb-2 text-xs ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</p>}

      {loading ? (
        <p className="text-sm text-haze">Loading videos…</p>
      ) : videos.length === 0 ? (
        <p className="text-sm text-haze">No videos on this profile yet.</p>
      ) : (
        <ul className="space-y-2">
          {videos.map((v) => {
            const inline = isEmbedUrlAllowed(v.embedUrl ?? null);
            return (
              <li
                key={v.id}
                className="rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-tan ring-1 ring-inset ring-white/15">
                    {v.platform}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-cream">
                      {v.creatorDisplayName || v.creatorHandle}
                      <span className="ml-1 font-normal text-haze">{v.caption}</span>
                    </p>
                    <p className="flex items-center gap-1 text-[10px] text-haze">
                      <MaterialIcon
                        name={inline ? "play_circle" : "open_in_new"}
                        className={`text-[11px] ${inline ? "text-mint" : "text-haze"}`}
                      />
                      {inline ? "plays inline" : "links out"} · {v.legalDisplayStatus}
                    </p>
                  </div>
                  {v.sourceUrl && (
                    <a
                      href={v.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md p-1.5 text-haze hover:bg-white/10 hover:text-cream"
                      aria-label="Open source"
                    >
                      <MaterialIcon name="open_in_new" className="text-sm" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeVideo(v.id)}
                    aria-label="Remove video"
                    className="shrink-0 rounded-md p-1.5 text-haze hover:bg-chili/10 hover:text-chili-soft"
                  >
                    <MaterialIcon name="delete" className="text-sm" />
                  </button>
                </div>

                {/* Raw debug — the exact stored restaurant_videos fields. */}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-haze">
                    raw row
                  </summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
                    <dt className="text-haze">id</dt>
                    <dd className="truncate text-tan">{v.id}</dd>
                    <dt className="text-haze">platform</dt>
                    <dd className="text-tan">{v.platform}</dd>
                    <dt className="text-haze">sourceType</dt>
                    <dd className="text-tan">{v.sourceType ?? "—"}</dd>
                    <dt className="text-haze">legalDisplayStatus</dt>
                    <dd className={inline ? "text-mint" : "text-tan"}>{v.legalDisplayStatus}</dd>
                    <dt className="text-haze">embedUrl</dt>
                    <dd className="break-all text-tan">{v.embedUrl ?? "—"}</dd>
                    <dt className="text-haze">sourceUrl</dt>
                    <dd className="break-all text-tan">{v.sourceUrl ?? "—"}</dd>
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TagField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-cream">{label}</span>
        {hint && <span className="truncate text-[9px] text-haze">{hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
      />
    </label>
  );
}
