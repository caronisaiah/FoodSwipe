"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";
import { AdminScopeContext } from "@/components/AdminCandidates";
import AuditPanel from "@/components/admin-review/AuditPanel";
import DetailsPanel from "@/components/admin-review/DetailsPanel";
import IdentityPanel from "@/components/admin-review/IdentityPanel";
import MapReadinessPanel from "@/components/admin-review/MapReadinessPanel";
import PhotographyPanel from "@/components/admin-review/PhotographyPanel";
import ReadinessRail from "@/components/admin-review/ReadinessRail";
import VideoReviewPanel from "@/components/admin-review/VideoReviewPanel";
import type { ReviewPayload } from "@/components/admin-review/types";
import { Chip, inputClass, primaryButton, quietButton } from "@/components/admin-review/ui";

/*
  Unified restaurant review workspace (INTERNAL). One page per restaurant candidate, addressed by its stable
  database id, that brings identity, details, photography, creator-video leads, map readiness, the publication
  checklist and recent audit history together, so one restaurant can be reviewed without moving between pages.

  The admin secret stays in component memory only, like every other admin screen: it is never written to
  sessionStorage, localStorage, a cookie or the URL, and it is gone when the page is closed or reloaded.

  Read once from GET /api/admin/restaurants/candidates/[id]/review; every change goes through the existing
  validated admin APIs and then re-reads that one endpoint. Opening the page changes nothing.
*/

const JUMPS = [
  ["identity", "Identity"], ["details", "Details"], ["photo", "Photo"], ["videos", "Videos"], ["map", "Map"], ["audit", "Audit"],
] as const;

const STATUS_TONE: Record<string, "mint" | "saffron" | "chili" | "tan"> = { approved: "mint", needs_review: "saffron", rejected: "chili", candidate: "tan" };

export default function AdminRestaurantReview({ candidateId }: { candidateId: string }) {
  const [secret, setSecret] = useState("");
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (silent: boolean, key: string) => {
    if (!key.trim()) { setError("Enter the admin secret first."); return; }
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidateId}/review`, { headers: { "x-foodswipe-admin-secret": key }, cache: "no-store" });
      const data = (await res.json()) as ReviewPayload & { error?: string };
      if (mine !== seq.current) return;
      if (!res.ok) { if (!silent) setReview(null); setError(data.error ?? `Could not load the review (${res.status}).`); return; }
      setReview(data);
    } catch {
      if (mine === seq.current) setError("Network error: could not reach the admin API.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [candidateId]);

  const refresh = useCallback(() => { void load(true, secret); }, [load, secret]);
  const candidate = review?.candidate;

  return (
    <AdminScopeContext.Provider value={review?.adminScope ?? null}>
      <div className="mx-auto min-h-dvh w-full max-w-7xl px-3 pb-20 pt-[max(env(safe-area-inset-top),0.75rem)] sm:px-5">
        <nav className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-haze">
          <Link href="/admin/restaurants/candidates" className="inline-flex items-center gap-1 underline-offset-2 hover:underline"><MaterialIcon name="arrow_back" className="text-sm" />All candidates</Link>
          <span className="flex gap-3">
            <Link href="/admin/videos/candidates" className="underline-offset-2 hover:underline">Video queue</Link>
            <Link href={`/admin/audit?resource=${encodeURIComponent(candidateId)}`} className="underline-offset-2 hover:underline">Audit history</Link>
          </span>
        </nav>

        <div className="mb-4 rounded-xl bg-surface-1 p-3 ring-1 ring-inset ring-white/10">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1">
              <span className="mb-1 flex items-baseline justify-between"><span className="text-xs font-semibold text-cream">Admin secret</span><span className="text-[10px] text-haze">session only, never stored</span></span>
              <input type="password" className={inputClass} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="FOODSWIPE_ADMIN_SECRET" autoComplete="off"
                onKeyDown={(e) => { if (e.key === "Enter") void load(false, secret); }} />
            </label>
            <button type="button" className={primaryButton} onClick={() => void load(false, secret)} disabled={loading}>{loading ? "Loading…" : review ? "Reload" : "Open review"}</button>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-chili-soft">{error}</p>}
        </div>

        {!review ? (
          <p className="text-sm text-haze">{loading ? "Loading…" : "Enter the admin secret and press Open review. Opening a review only reads data: it never approves, publishes or changes anything."}</p>
        ) : (
          <>
            <header className="mb-4">
              <h1 className="font-display text-2xl font-bold text-cream sm:text-3xl" data-testid="review-title">{candidate?.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-haze">
                <Chip tone={STATUS_TONE[candidate?.status ?? ""] ?? "tan"}>{candidate?.status.replace("_", " ")}</Chip>
                <Chip tone="tan">{candidate?.market.toUpperCase()}</Chip>
                {review.promoted && <Chip tone="mint">Published as /{review.promoted.slug}</Chip>}
                <span data-testid="admin-scope" className={review.adminScope === "draft" ? "text-saffron" : "text-mint"}>
                  {review.adminScope === "draft" ? "Draft credential: you can prepare, not publish" : "Publication credential"}
                </span>
              </p>
              <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-1.5">
                {JUMPS.map(([id, label]) => <a key={id} href={`#${id}`} className={quietButton}>{label}</a>)}
              </nav>
            </header>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="order-2 space-y-4 lg:order-1">
                <IdentityPanel key={`id-${candidate?.updatedAt}`} review={review} secret={secret} onChanged={refresh} />
                <DetailsPanel key={`d-${candidate?.updatedAt}`} review={review} secret={secret} onChanged={refresh} />
                <PhotographyPanel review={review} secret={secret} onChanged={refresh} />
                <VideoReviewPanel review={review} secret={secret} onChanged={refresh} />
                <MapReadinessPanel review={review} />
                <AuditPanel review={review} />
              </div>
              <div className="order-1 lg:order-2">
                <div className="lg:sticky lg:top-3 lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-y-auto">
                  <ReadinessRail review={review} secret={secret} onChanged={refresh} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminScopeContext.Provider>
  );
}
