"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoSourceHref } from "@/lib/video";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * The profile's "Go there" actions. Client-side so the "Reviews" link reflects
 * the SAME merged set the carousel shows — seed + shared (persisted backend) +
 * local (localStorage) — using `videoSourceHref` so it never disagrees about
 * what's linkable. The shared fetch is best-effort (falls back to seed/local).
 */
export default function GoThere({
  restaurantId,
  seedVideos,
  directionsUrl,
}: {
  restaurantId: string;
  seedVideos: Video[];
  directionsUrl: string;
}) {
  const { videos: manualVideos } = useManualVideos(restaurantId);
  const [shared, setShared] = useState<Video[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${restaurantId}/videos`);
        const data = (await res.json()) as { videos?: Video[] };
        if (!cancelled) setShared(Array.isArray(data.videos) ? data.videos : []);
      } catch {
        if (!cancelled) setShared([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const reviewsHref = [...seedVideos, ...shared, ...manualVideos]
    .map(videoSourceHref)
    .find((h): h is string => !!h);

  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-lg font-semibold text-cream">Go there</h2>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ExternalLink href={directionsUrl} icon="near_me" label="Directions" primary />
        <ExternalLink href="#" icon="language" label="Website" disabled />
        {reviewsHref ? (
          <ExternalLink href={reviewsHref} icon="play_circle" label="Reviews" />
        ) : (
          <ExternalLink href="#" icon="play_circle" label="Reviews" disabled />
        )}
      </div>
    </section>
  );
}

function ExternalLink({
  href,
  icon,
  label,
  disabled = false,
  primary = false,
}: {
  href: string;
  icon: string;
  label: string;
  disabled?: boolean;
  /** Saffron-filled "go there" CTA (Directions). */
  primary?: boolean;
}) {
  const base =
    "flex flex-col items-center gap-1 rounded-2xl py-3.5 text-xs font-semibold ring-1 ring-inset transition";
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${label} — coming soon`}
        title="Coming soon"
        className={`${base} cursor-not-allowed bg-surface text-haze/60 ring-white/10`}
      >
        <MaterialIcon name={icon} className="text-[22px]" />
        {label}
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        primary
          ? `${base} bg-brand-gradient text-saffron-ink ring-transparent shadow-lg shadow-saffron/20 active:scale-[0.98]`
          : `${base} bg-surface text-cream ring-white/10 hover:bg-surface-2`
      }
    >
      <MaterialIcon name={icon} className="text-[22px]" />
      {label}
    </a>
  );
}
