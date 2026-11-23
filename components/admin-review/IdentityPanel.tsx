"use client";

import { useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";
import { listMarkets } from "@/lib/markets";
import { DRAFT_HINT, apiErrorText, shortDate, useCanPublish } from "@/components/AdminCandidates";
import { Chip, Section, inputClass, primaryButton, shortDay } from "./ui";
import type { SectionProps } from "./types";

/*
  A. Restaurant identity. Edits go through the existing validated PATCH /api/admin/restaurants/candidates/[id];
  only fields that actually changed are sent, so saving never rewrites anything the reviewer did not touch.
  Missing or unverified data is called out in place rather than left blank.
*/

const DUPLICATE_CODES = new Set(["possible_duplicate", "possible_duplicate_address", "possible_duplicate_name", "same_name_other_location", "same_address_different_name"]);

function expiry(iso: string | null): { label: string; tone: "mint" | "saffron" | "chili" | "haze" } {
  if (!iso) return { label: "No expiry recorded", tone: "haze" };
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return { label: "No expiry recorded", tone: "haze" };
  if (ms < 0) return { label: `Expired ${shortDate(iso)}`, tone: "chili" };
  if (ms < 7 * 86_400_000) return { label: `Expires ${shortDate(iso)}`, tone: "saffron" };
  return { label: `Fresh until ${shortDate(iso)}`, tone: "mint" };
}

export default function IdentityPanel({ review, secret, onChanged }: SectionProps) {
  const { candidate, publicationChecks, mapReadiness, promoted } = review;
  const canPublish = useCanPublish();
  const locked = !canPublish && candidate.status === "approved";
  const [name, setName] = useState(candidate.name);
  const [address, setAddress] = useState(candidate.address ?? "");
  const [neighborhood, setNeighborhood] = useState(candidate.neighborhood ?? "");
  const [market, setMarket] = useState(candidate.market);
  const [placeId, setPlaceId] = useState(candidate.googlePlaceId ?? "");
  const [website, setWebsite] = useState(candidate.websiteDomain ?? "");
  const [lat, setLat] = useState(candidate.lat === null || candidate.lat === undefined ? "" : String(candidate.lat));
  const [lng, setLng] = useState(candidate.lng === null || candidate.lng === undefined ? "" : String(candidate.lng));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const trimmed = (v: string) => v.trim();
  const nullable = (v: string) => (trimmed(v) === "" ? null : trimmed(v));

  function changes(): { body: Record<string, unknown>; problem: string | null } {
    const body: Record<string, unknown> = {};
    if (trimmed(name) !== candidate.name) body.name = trimmed(name);
    if (nullable(address) !== (candidate.address ?? null)) body.address = nullable(address);
    if (nullable(neighborhood) !== (candidate.neighborhood ?? null)) body.neighborhood = nullable(neighborhood);
    if (market !== candidate.market) body.market = market;
    if (nullable(placeId) !== (candidate.googlePlaceId ?? null)) body.googlePlaceId = nullable(placeId);
    if (nullable(website) !== (candidate.websiteDomain ?? null)) body.websiteDomain = nullable(website);
    const latText = trimmed(lat), lngText = trimmed(lng);
    const before = { lat: candidate.lat ?? null, lng: candidate.lng ?? null };
    if (latText === "" && lngText === "") {
      if (before.lat !== null || before.lng !== null) { body.lat = null; body.lng = null; }
    } else {
      const a = Number(latText), b = Number(lngText);
      if (latText === "" || lngText === "" || !Number.isFinite(a) || !Number.isFinite(b)) {
        return { body, problem: "Latitude and longitude must both be numbers (or both blank)." };
      }
      if (a !== before.lat || b !== before.lng) { body.lat = a; body.lng = b; }
    }
    return { body, problem: null };
  }

  const pending = changes();
  const dirty = Object.keys(pending.body).length > 0;

  async function save() {
    if (saving || !dirty) return;
    if (pending.problem) { setMsg({ type: "err", text: pending.problem }); return; }
    if (!secret.trim()) { setMsg({ type: "err", text: "Enter the admin secret first." }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify(pending.body),
      });
      const data = (await res.json()) as { error?: string; errors?: { field: string; message: string }[]; warnings?: { message: string }[] };
      if (!res.ok) { setMsg({ type: "err", text: apiErrorText(data, `Save failed (${res.status}).`) }); return; }
      setMsg({ type: "ok", text: `Saved ${Object.keys(pending.body).join(", ")}.${data.warnings?.length ? ` Note: ${data.warnings.map((w) => w.message).join(" ")}` : ""}` });
      onChanged();
    } catch {
      setMsg({ type: "err", text: "Network error. Nothing was confirmed; refresh before retrying." });
    } finally {
      setSaving(false);
    }
  }

  const exp = expiry(candidate.sourceExpiresAt);
  const evidence = candidate.websiteEvidenceMeta;
  const duplicates = publicationChecks.filter((c) => DUPLICATE_CODES.has(c.code));
  const placeNote = publicationChecks.find((c) => c.code === "missing_place_identity" || c.code === "malformed_place_identity" || c.code === "place_identity_unverified");
  const outside = publicationChecks.find((c) => c.code === "coordinates_outside_market");
  const missing: string[] = [];
  if (!candidate.address) missing.push("address");
  if (!candidate.googlePlaceId) missing.push("Google Place ID");
  if (candidate.lat === null || candidate.lat === undefined) missing.push("coordinates");
  if (!candidate.neighborhood) missing.push("neighborhood");
  if (!candidate.websiteDomain) missing.push("website");

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="block min-w-0">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-cream">{label}</span>
        {hint && <span className="text-[10px] text-haze">{hint}</span>}
      </span>
      {node}
    </label>
  );

  return (
    <Section
      id="identity" title="Identity" icon="badge"
      chip={missing.length > 0 ? <Chip tone="saffron">Missing: {missing.join(", ")}</Chip> : <Chip tone="mint">Core fields present</Chip>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Name", <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} disabled={locked} />)}
        {field("Market", (
          <select className={inputClass} value={market} onChange={(e) => setMarket(e.target.value)} disabled={locked || Boolean(promoted)} data-testid="review-market">
            {listMarkets().map((m) => <option key={m.id} value={m.id} className="bg-surface">{m.shortName}</option>)}
          </select>
        ), promoted ? "locked after publication" : undefined)}
        <div className="sm:col-span-2">{field("Address", <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} disabled={locked} placeholder="Street address" />)}</div>
        {field("Neighborhood", <input className={inputClass} value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} disabled={locked} placeholder="e.g. West Village" />)}
        {field("Website domain", <input className={inputClass} value={website} onChange={(e) => setWebsite(e.target.value)} disabled={locked} placeholder="example.com (no https://)" />)}
        {field("Latitude", <input className={`${inputClass} font-mono`} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} disabled={locked} placeholder="40.7306" />)}
        {field("Longitude", <input className={`${inputClass} font-mono`} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} disabled={locked} placeholder="-73.9866" />)}
        <div className="sm:col-span-2">{field("Google Place ID", <input className={`${inputClass} font-mono`} value={placeId} onChange={(e) => setPlaceId(e.target.value)} disabled={locked} placeholder="ChIJ…" />, "checked for conflicts on save")}</div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || !dirty || locked} className={primaryButton}>
          {saving ? "Saving…" : dirty ? `Save ${Object.keys(pending.body).length} change${Object.keys(pending.body).length === 1 ? "" : "s"}` : "No changes"}
        </button>
        {locked && <span className="text-[11px] text-saffron">{DRAFT_HINT}</span>}
        {pending.problem && dirty === false && <span className="text-[11px] text-chili-soft">{pending.problem}</span>}
        {msg && <span role="status" className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</span>}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Status</dt><dd className="text-cream">{candidate.status.replace("_", " ")}{promoted ? ` · published as /${promoted.slug}` : ""}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Source</dt><dd className="text-cream">{candidate.source === "google_places" ? "Google Places import" : "Entered by hand"}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Source freshness</dt><dd><Chip tone={exp.tone}>{exp.label}</Chip></dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Website evidence</dt><dd className="text-cream">{!candidate.websiteDomain ? "No website to check" : evidence && evidence.okDocs > 0 ? `${evidence.okDocs} page${evidence.okDocs === 1 ? "" : "s"} collected${evidence.latestFetchedAt ? `, latest ${shortDay(evidence.latestFetchedAt)}` : ""}${evidence.stale ? " (stale)" : ""}` : "None collected yet"}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Coordinates</dt><dd className={mapReadiness.coordinates.state === "valid" ? "text-cream" : "text-saffron"}>{mapReadiness.coordinates.state === "valid" ? "Valid" : mapReadiness.coordinates.detail}</dd></div>
        <div className="flex gap-2"><dt className="w-28 shrink-0 text-haze">Record id</dt><dd className="break-all font-mono text-[10px] text-tan">{candidate.id}</dd></div>
      </dl>

      {(placeNote || outside || duplicates.length > 0) && (
        <ul className="mt-3 space-y-1.5" data-testid="identity-warnings">
          {placeNote && (
            <li className="flex items-start gap-1.5 rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/30">
              <MaterialIcon name="pin_drop" className="mt-px text-sm" />{placeNote.message}
            </li>
          )}
          {outside && (
            <li className="flex items-start gap-1.5 rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/30">
              <MaterialIcon name="location_off" className="mt-px text-sm" />{outside.message}
            </li>
          )}
          {duplicates.map((d, i) => (
            <li key={`${d.code}-${d.existing?.id ?? i}`} className={`flex items-start gap-1.5 rounded-lg p-2 text-[11px] ring-1 ring-inset ${d.severity === "warning" ? "bg-saffron/10 text-saffron ring-saffron/30" : "bg-white/5 text-tan ring-white/10"}`}>
              <MaterialIcon name="content_copy" className="mt-px text-sm" />
              <span>
                {d.message}{" "}
                {d.existing && (d.existing.kind === "candidate"
                  ? <Link className="underline underline-offset-2" href={`/admin/restaurants/candidates/${d.existing.id}`}>Open that draft</Link>
                  : d.existing.slug ? <a className="underline underline-offset-2" href={`/restaurants/${d.existing.slug}`} target="_blank" rel="noopener noreferrer">View it live</a> : null)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
