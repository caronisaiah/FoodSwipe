"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { useManualVideos } from "@/lib/storage";
import { videoSourceHref } from "@/lib/video";

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
        <ExternalLink href={directionsUrl} icon="🧭" label="Directions" />
        <ExternalLink href="#" icon="🌐" label="Website" disabled />
        {reviewsHref ? (
          <ExternalLink href={reviewsHref} icon="▶" label="Reviews" />
        ) : (
          <ExternalLink href="#" icon="▶" label="Reviews" disabled />
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
}: {
  href: string;
  icon: string;
  label: string;
  disabled?: boolean;
}) {
  const base =
    "flex flex-col items-center gap-1 rounded-2xl bg-surface py-3.5 text-xs font-semibold ring-1 ring-inset ring-white/10 transition";
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${label} — coming soon`}
        title="Coming soon"
        className={`${base} cursor-not-allowed text-haze/60`}
      >
        <span className="text-xl" aria-hidden>
          {icon}
        </span>
        {label}
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} text-cream hover:bg-surface-2`}
    >
      <span className="text-xl" aria-hidden>
        {icon}
      </span>
      {label}
    </a>
  );
}
