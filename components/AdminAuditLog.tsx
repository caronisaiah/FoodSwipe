"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Read-only audit history (INTERNAL). Needs the PUBLICATION credential: the draft credential is refused by
  the API. Shows what changed, when, which credential did it, and on which record. There is no edit or
  delete control because there is no such route.

  The "who" is a CREDENTIAL, not a person: every request carrying the same shared secret looks the same.
  The page says so on every row so an "approved" event is not read as "a named human reviewed this".
*/

interface AuditEvent {
  id: string;
  seq: number;
  occurredAt: string;
  action: string;
  category: string | null;
  resourceType: string;
  resourceId: string;
  relatedResourceType: string | null;
  relatedResourceId: string | null;
  actorIdentity: string;
  authScope: string;
  actorAssurance: string;
  requestId: string;
  changes: Record<string, { from?: unknown; to?: unknown }>;
  details: Record<string, unknown>;
  reason: string | null;
}

interface AuditResponse {
  events?: AuditEvent[];
  nextBefore?: number | null;
  integrity?: { appendOnlyTriggersPresent: boolean };
  requester?: { identity: string; scope: string };
  error?: string;
  code?: string;
}

const RESOURCE_TYPES = ["", "restaurant_candidate", "restaurant", "video_candidate", "restaurant_video"] as const;
const DAYS = [
  { value: "", label: "All time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];
const CATEGORY_STYLE: Record<string, string> = {
  draft_modification: "bg-white/10 text-haze",
  approval: "bg-mint/15 text-mint",
  publication: "bg-saffron/20 text-saffron",
  edit: "bg-white/10 text-cream",
  removal: "bg-chili/20 text-chili-soft",
  recovery: "bg-mint/15 text-mint",
};

const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

function label(action: string): string {
  return action.replace(/[._]/g, " ");
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object" && value !== null && "_clipped" in value) {
    const v = value as { length?: number; preview?: string };
    return `(long value, ${v.length ?? "?"} chars) ${v.preview ?? ""}…`;
  }
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  return JSON.stringify(value);
}

export default function AdminAuditLog({ initialResource = "" }: { initialResource?: string }) {
  const [secret, setSecret] = useState("");
  const [resource, setResource] = useState(initialResource);
  const [resourceType, setResourceType] = useState<string>("");
  const [days, setDays] = useState("");
  const [requestId, setRequestId] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [integrity, setIntegrity] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function load(append = false, overrides: { requestId?: string } = {}) {
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "25" });
    if (resource.trim()) params.set("resourceId", resource.trim());
    if (resourceType) params.set("resourceType", resourceType);
    if (days) params.set("days", days);
    const rid = overrides.requestId ?? requestId;
    if (rid.trim()) params.set("requestId", rid.trim());
    if (append && nextBefore) params.set("before", String(nextBefore));
    try {
      const res = await fetch(`/api/admin/audit/events?${params}`, { headers: { "x-foodswipe-admin-secret": secret } });
      const data = (await res.json()) as AuditResponse;
      if (mine !== seq.current) return;
      if (!res.ok) {
        if (!append) setEvents([]);
        setError(
          data.code === "insufficient_scope"
            ? "The audit history needs the publication credential. The draft credential cannot read it."
            : data.error ?? `Load failed (${res.status}).`,
        );
        return;
      }
      setEvents((prev) => (append ? [...prev, ...(data.events ?? [])] : data.events ?? []));
      setNextBefore(data.nextBefore ?? null);
      setIntegrity(data.integrity?.appendOnlyTriggersPresent ?? null);
      setLoadedOnce(true);
    } catch {
      if (mine === seq.current) setError("Network error — could not reach the admin API.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 rounded-xl border border-saffron/30 bg-saffron/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-saffron">
          <MaterialIcon name="history" className="text-sm" />
          Audit history
        </p>
        <p className="mt-0.5 text-cream/80">
          Read-only record of consequential admin changes. “Credential” is the shared admin secret that made the
          request — it identifies a credential, not a person, so an approval here does not prove a particular human
          reviewed the content.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">What changed, and when</h1>
        <nav className="flex gap-3 text-xs text-haze">
          <Link href="/admin/restaurants/candidates" className="underline-offset-2 hover:underline">Candidates</Link>
          <Link href="/admin/videos/published" className="underline-offset-2 hover:underline">Published videos</Link>
        </nav>
      </header>

      <label className="mb-3 block">
        <span className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-semibold text-cream">Admin secret (publication)</span>
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

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-haze">
          Record id (restaurant, candidate, video)
          <input
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            placeholder="paste an id to see one record’s history"
            className="mt-0.5 w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
          />
        </label>
        <label className="block text-[11px] text-haze">
          Request id
          <input
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="all changes made by one request"
            className="mt-0.5 w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
          />
        </label>
        <label className="block text-[11px] text-haze">
          Record type
          <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="mt-0.5 w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream ring-1 ring-inset ring-white/10">
            {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t ? label(t) : "All records"}</option>)}
          </select>
        </label>
        <label className="block text-[11px] text-haze">
          Recent activity
          <select value={days} onChange={(e) => setDays(e.target.value)} className="mt-0.5 w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream ring-1 ring-inset ring-white/10">
            {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
        >
          <MaterialIcon name="refresh" className="text-sm" />
          {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load history"}
        </button>
        {integrity !== null && (
          <span className={`text-[10px] ${integrity ? "text-mint" : "text-chili-soft"}`} data-testid="integrity">
            {integrity ? "Append-only protection active" : "Append-only triggers NOT found — apply migration 0013"}
          </span>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-chili-soft" role="alert">{error}</p>}

      {!loadedOnce && !error ? (
        <p className="text-sm text-haze">Enter the publication secret and press Load history.</p>
      ) : events.length === 0 && !loading && !error ? (
        <p className="text-sm text-haze" data-testid="empty">No recorded changes match. History starts when migration 0013 is applied; earlier changes are not backfilled.</p>
      ) : (
        <ol className="space-y-2" data-testid="events">
          {events.map((e) => (
            <li key={e.id} className="rounded-xl bg-surface-1 p-2.5 ring-1 ring-inset ring-white/10" data-testid="event">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-display text-sm font-bold capitalize text-cream">{label(e.action)}</span>
                {e.category && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_STYLE[e.category] ?? "bg-white/10 text-haze"}`}>
                    {e.category.replace("_", " ")}
                  </span>
                )}
                <time className="ml-auto text-[10px] text-haze" dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleString()}</time>
              </div>
              <p className="mt-1 text-[11px] text-haze">
                <span className="text-cream">{e.resourceType.replace("_", " ")}</span>{" "}
                <button type="button" className="break-all font-mono text-[10px] underline-offset-2 hover:underline" onClick={() => { setResource(e.resourceId); }} title="Use this id as the filter">
                  {e.resourceId}
                </button>
                {e.relatedResourceId && (
                  <> · related {e.relatedResourceType?.replace("_", " ")} <span className="break-all font-mono text-[10px]">{e.relatedResourceId}</span></>
                )}
              </p>
              <p className="mt-0.5 text-[11px] text-haze">
                Credential <span className="font-semibold text-cream">{e.actorIdentity}</span> ({e.authScope} scope, {e.actorAssurance.replace("-", " ")}) ·{" "}
                request{" "}
                <button type="button" className="font-mono text-[10px] underline-offset-2 hover:underline" onClick={() => { setRequestId(e.requestId); void load(false, { requestId: e.requestId }); }} title="Show every change made by this request">
                  {e.requestId.slice(0, 13)}
                </button>
              </p>
              {Object.entries(e.changes).filter(([, c]) => !(isEmpty(c.from) && isEmpty(c.to))).length > 0 && (
                <dl className="mt-1.5 space-y-0.5 rounded-lg bg-ink-2 p-1.5 text-[11px]">
                  {Object.entries(e.changes).filter(([, c]) => !(isEmpty(c.from) && isEmpty(c.to))).map(([field, c]) => (
                    <div key={field} className="flex flex-wrap gap-x-1.5">
                      <dt className="font-mono text-haze">{field}</dt>
                      <dd className="text-cream/90">
                        {!isEmpty(c.from) && (
                          <><span className="text-chili-soft line-through decoration-chili-soft/50">{fmt(c.from)}</span>{" → "}</>
                        )}
                        <span className="text-mint">{fmt(c.to)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {e.reason && <p className="mt-1 text-[11px] text-cream/90">Reason: “{e.reason}”</p>}
              {Object.keys(e.details).length > 0 && (
                <p className="mt-0.5 break-words text-[10px] text-haze">{Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {nextBefore && (
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
        >
          Load older
        </button>
      )}
    </div>
  );
}
