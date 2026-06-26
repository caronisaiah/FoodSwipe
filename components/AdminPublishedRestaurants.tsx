"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Internal editor for DB-PUBLISHED / live restaurants — NOT a public feature.

  Published restaurants are created by promoting a reviewed candidate; they live
  in the `restaurants` DB table and the feed serves them alongside seed data.
  This page lets a reviewer keep improving their tags/copy/visibility after
  promotion. Secret-gated like the rest of the admin surface. SEED restaurants are
  code-managed and are NOT editable here.

  Types mirrored locally so the Neon/Drizzle runtime never bundles into the client.
*/

const STATUS_FILTERS = ["all", "published", "hidden"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const VOCAB_HINT = {
  cuisine: "e.g. mexican, tacos, ramen, italian, pizza, bakery, coffee",
  dietary: "vegan, vegetarian, halal, gluten-free, no pork",
  vibe: "quick bite, date night, group dinner, late night, casual, hidden gem",
  bestFor: "quick bite, date night, group dinner, late night, casual",
  dish: 'short dishes, e.g. "Tacos", "Ramen"',
};

interface Published {
  id: string;
  slug: string;
  name: string;
  market: string;
  neighborhood: string;
  address: string;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  lat: number | null;
  lng: number | null;
  distanceMiles: number;
  priceLevel: number;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  dishHighlights: string[];
  bestFor: string[];
  reasonText: string;
  status: string;
  sourceCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

type Msg = { type: "ok" | "err"; text: string } | null;

function parseList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}
function priceLabel(level: number): string {
  return level >= 1 && level <= 4 ? "$".repeat(level) : "—";
}
function numOrNull(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}

export default function AdminPublishedRestaurants() {
  const [secret, setSecret] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [list, setList] = useState<Published[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Msg>(null);
  const loadSeq = useRef(0);

  async function load() {
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/restaurants/published", {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { restaurants?: Published[]; error?: string };
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        setList([]);
        setError(data.error ?? `Load failed (${res.status}).`);
        return;
      }
      setList(Array.isArray(data.restaurants) ? data.restaurants : []);
      setLoadedOnce(true);
    } catch {
      if (seq === loadSeq.current) setError("Network error — could not reach the admin API.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  function onSaved(updated: Published) {
    setActionMsg({ type: "ok", text: `Saved “${updated.name}” → ${updated.status}.` });
    setList((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
  }

  const visible = list.filter((r) => statusFilter === "all" || r.status === statusFilter);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 rounded-xl border border-saffron/30 bg-saffron/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-saffron">
          <MaterialIcon name="storefront" className="text-sm" />
          Published restaurant editor
        </p>
        <p className="mt-0.5 text-cream/80">
          DB-published restaurants only — these are served to the live feed. Seed
          restaurants are still code-managed and are not editable here. Edits show
          on the next feed fetch.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">Published restaurants</h1>
        <Link href="/admin/restaurants/candidates" className="text-xs text-haze underline-offset-2 hover:underline">
          ← Candidates
        </Link>
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

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset transition ${
              statusFilter === f ? "bg-white/15 text-cream ring-white/20" : "text-haze ring-white/10 hover:bg-white/5"
            }`}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
        >
          <MaterialIcon name="refresh" className="text-sm" />
          {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load"}
        </button>
      </div>

      {actionMsg && <p className="mb-2 text-xs text-mint">{actionMsg.text}</p>}
      {error && <p className="mb-2 text-xs text-chili-soft">{error}</p>}

      {!loadedOnce && !error ? (
        <p className="text-sm text-haze">Enter the admin secret and press Load to list published restaurants.</p>
      ) : visible.length === 0 && !loading ? (
        <p className="text-sm text-haze">
          No published restaurants{statusFilter !== "all" ? ` with status “${statusFilter}”` : ""}. Promote an
          approved candidate from the Candidates console.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
          {visible.map((r) => (
            <PublishedRow
              key={r.id}
              row={r}
              secret={secret}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))}
              onSaved={onSaved}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishedRow({
  row,
  secret,
  expanded,
  onToggle,
  onSaved,
}: {
  row: Published;
  secret: string;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (updated: Published) => void;
}) {
  return (
    <li className="bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-white/[0.03]"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-cream">{row.name}</p>
          <p className="truncate text-[11px] text-haze">
            {row.neighborhood ? `${row.neighborhood} · ` : ""}/{row.slug} · {priceLabel(row.priceLevel)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-tan ring-1 ring-inset ring-white/15">
          {row.market}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
            row.status === "published"
              ? "bg-mint/15 text-mint ring-mint/30"
              : "bg-white/10 text-haze ring-white/15"
          }`}
        >
          {row.status}
        </span>
        <MaterialIcon name={expanded ? "expand_less" : "expand_more"} className="shrink-0 text-base text-haze" />
      </button>
      {expanded && <PublishedEditor key={row.updatedAt} row={row} secret={secret} onSaved={onSaved} />}
    </li>
  );
}

function PublishedEditor({
  row,
  secret,
  onSaved,
}: {
  row: Published;
  secret: string;
  onSaved: (updated: Published) => void;
}) {
  const [name, setName] = useState(row.name);
  const [neighborhood, setNeighborhood] = useState(row.neighborhood);
  const [address, setAddress] = useState(row.address);
  const [websiteDomain, setWebsiteDomain] = useState(row.websiteDomain ?? "");
  const [googlePlaceId, setGooglePlaceId] = useState(row.googlePlaceId ?? "");
  const [lat, setLat] = useState(row.lat === null ? "" : String(row.lat));
  const [lng, setLng] = useState(row.lng === null ? "" : String(row.lng));
  const [priceLevel, setPriceLevel] = useState(String(row.priceLevel));
  const [cuisine, setCuisine] = useState(row.cuisineTags.join(", "));
  const [dietary, setDietary] = useState(row.dietaryTags.join(", "));
  const [vibe, setVibe] = useState(row.vibeTags.join(", "));
  const [bestFor, setBestFor] = useState(row.bestFor.join(", "));
  const [dishes, setDishes] = useState(row.dishHighlights.join(", "));
  const [reasonText, setReasonText] = useState(row.reasonText);
  const [status, setStatus] = useState(row.status);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save(overrideStatus?: string) {
    if (saving) return;
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    const nextStatus = overrideStatus ?? status;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/published/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({
          name,
          neighborhood,
          address,
          websiteDomain,
          googlePlaceId,
          lat: numOrNull(lat),
          lng: numOrNull(lng),
          priceLevel: Number(priceLevel) || row.priceLevel,
          cuisineTags: parseList(cuisine),
          dietaryTags: parseList(dietary),
          vibeTags: parseList(vibe),
          bestFor: parseList(bestFor),
          dishHighlights: parseList(dishes),
          reasonText,
          status: nextStatus,
        }),
      });
      const data = (await res.json()) as { restaurant?: Published; error?: string };
      if (!res.ok || !data.restaurant) {
        setMsg({ type: "err", text: data.error ?? `Save failed (${res.status}).` });
        return;
      }
      onSaved(data.restaurant);
    } catch {
      setMsg({ type: "err", text: "Network error saving changes." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5 border-t border-line bg-ink-2/40 p-3">
      <div className="flex items-center justify-between">
        <a
          href={`/restaurants/${row.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-saffron underline-offset-2 hover:underline"
        >
          <MaterialIcon name="open_in_new" className="text-[11px]" />
          View /restaurants/{row.slug}
        </a>
        <span className="text-[10px] text-haze">
          {row.sourceCandidateId ? "from candidate" : "manual"} · {row.distanceMiles} mi
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TField label="Name" value={name} onChange={setName} />
        <TField label="Neighborhood" value={neighborhood} onChange={setNeighborhood} />
      </div>
      <TField label="Address" value={address} onChange={setAddress} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TField label="Website domain" value={websiteDomain} onChange={setWebsiteDomain} placeholder="example.com" />
        <TField label="Google Place ID" value={googlePlaceId} onChange={setGooglePlaceId} />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <TField label="Lat" value={lat} onChange={setLat} />
        <TField label="Lng" value={lng} onChange={setLng} />
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-cream">Price (1–4)</span>
          <input
            type="number"
            min={1}
            max={4}
            value={priceLevel}
            onChange={(e) => setPriceLevel(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TField label="Cuisine tags" hint={VOCAB_HINT.cuisine} value={cuisine} onChange={setCuisine} />
        <TField label="Dietary tags" hint={VOCAB_HINT.dietary} value={dietary} onChange={setDietary} />
        <TField label="Vibe tags" hint={VOCAB_HINT.vibe} value={vibe} onChange={setVibe} />
        <TField label="Best for" hint={VOCAB_HINT.bestFor} value={bestFor} onChange={setBestFor} />
      </div>
      <TField label="Dish highlights" hint={VOCAB_HINT.dish} value={dishes} onChange={setDishes} />
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-cream">Reason text</span>
        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
        />
      </label>

      <p className="text-[10px] text-haze">
        Tags outside the controlled vocab are dropped on save (not an error).
      </p>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <label className="mr-1 flex items-center gap-1 text-[11px] text-haze">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md bg-surface-2 px-2 py-1 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
          >
            <option value="published" className="bg-surface">published</option>
            <option value="hidden" className="bg-surface">hidden</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status !== "hidden" && (
          <button
            type="button"
            onClick={() => void save("hidden")}
            disabled={saving}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-haze ring-1 ring-inset ring-white/15 transition hover:bg-white/10 disabled:opacity-40"
          >
            <MaterialIcon name="visibility_off" className="text-sm" />
            Hide from feed
          </button>
        )}
        {status === "hidden" && (
          <button
            type="button"
            onClick={() => void save("published")}
            disabled={saving}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-mint ring-1 ring-inset ring-mint/30 transition hover:bg-mint/10 disabled:opacity-40"
          >
            <MaterialIcon name="visibility" className="text-sm" />
            Publish to feed
          </button>
        )}
        {msg && (
          <span className={`ml-1 text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

function TField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
        className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
      />
    </label>
  );
}
