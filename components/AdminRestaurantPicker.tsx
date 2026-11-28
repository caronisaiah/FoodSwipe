"use client";

import { useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Searchable restaurant selector for the internal admin (NOT a public feature).

  Replaces typing a restaurant slug by hand. It searches draft candidates AND published restaurants
  (name, address, slug or exact Google Place ID) through GET /api/admin/restaurants/lookup and returns the
  chosen RECORD, so a video is linked by stable id. The market is always shown, because two restaurants
  with the same name can exist in different markets.
*/
export interface PickedRestaurant {
  kind: "candidate" | "published";
  id: string;
  name: string;
  slug: string | null;
  market: string;
  status: string;
  address: string | null;
  googlePlaceId: string | null;
  publishedSlug: string | null;
}

export default function AdminRestaurantPicker({
  secret,
  value,
  onChange,
  label = "Restaurant",
  disabled = false,
}: {
  secret: string;
  value: PickedRestaurant | null;
  onChange: (picked: PickedRestaurant | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedRestaurant[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  function search(text: string) {
    setQuery(text);
    setOpen(true);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    if (!text.trim()) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/restaurants/lookup?q=${encodeURIComponent(text.trim())}&limit=10`, {
          headers: { "x-foodswipe-admin-secret": secret },
          cache: "no-store",
        });
        const data = (await res.json()) as { results?: PickedRestaurant[]; error?: string };
        if (mine !== seq.current) return;
        if (!res.ok) {
          setResults([]);
          setError(data.error ?? `Search failed (${res.status}).`);
          return;
        }
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (mine === seq.current) setError("Network error while searching.");
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 250);
  }

  function pick(row: PickedRestaurant) {
    if (disabled) return; // saving: the target is frozen
    onChange(row);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  return (
    <div className="relative min-w-0" data-testid="restaurant-picker">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-haze">{label}</span>
      {value ? (
        <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-inset ring-mint/30" data-testid="picked-restaurant">
          <MaterialIcon name="storefront" className="mt-0.5 text-sm text-mint" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-cream">
              {value.name} <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">{value.market.toUpperCase()}</span>
            </p>
            <p className="break-words text-[11px] text-haze" data-testid="picked-restaurant-address">
              {value.kind === "candidate" ? `draft · ${value.status}` : `live · ${value.status}`}
              {value.publishedSlug ? ` · /${value.publishedSlug}` : ""}
              {value.address ? ` · ${value.address}` : ""}
            </p>
          </div>
          {!disabled && (
            <button type="button" onClick={() => onChange(null)} aria-label="Change restaurant" className="shrink-0 rounded-md px-2 py-1 text-xs text-haze hover:text-cream">
              Change
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            value={query}
            disabled={disabled}
            onChange={(e) => search(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Search a restaurant by name, address or Place ID"
            aria-label={`${label}: search`}
            aria-expanded={open}
            aria-controls="restaurant-picker-results"
            role="combobox"
            aria-autocomplete="list"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/70 focus:ring-saffron/60 disabled:opacity-50"
          />
          {open && !disabled && (query.trim() || error) && (
            <ul id="restaurant-picker-results" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg bg-ink-2 p-1 shadow-xl ring-1 ring-inset ring-white/15">
              {busy && <li className="px-2 py-1.5 text-xs text-haze">Searching…</li>}
              {error && <li role="status" className="px-2 py-1.5 text-xs text-chili-soft">{error}</li>}
              {!busy && !error && results.length === 0 && <li className="px-2 py-1.5 text-xs text-haze">No restaurant found. Import or create the restaurant first.</li>}
              {results.map((row) => (
                <li key={`${row.kind}-${row.id}`} role="option" aria-selected={false}>
                  <button type="button" disabled={disabled} onClick={() => pick(row)} className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/10">
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-cream">{row.market.toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-cream">{row.name}</span>
                      <span className="block break-words text-[11px] text-haze">
                        {row.kind === "candidate" ? `draft · ${row.status}` : `live · ${row.status}`}
                        {row.publishedSlug ? ` · /${row.publishedSlug}` : ""}
                        {row.address ? ` · ${row.address}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
