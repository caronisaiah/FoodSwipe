"use client";

import MaterialIcon from "@/components/MaterialIcon";
import type { GalleryPhase } from "@/lib/galleryState";

/**
 * Explicit photo navigation, the accessible alternative to tapping the photograph.
 * Before the gallery has loaded it offers one "more photos" button and claims nothing
 * about how many photos exist; previous/next and the position marks appear only once
 * the photos have actually been returned and validated.
 */
export function GalleryButtons({
  name, phase, canStep, offerMore, onStep,
}: {
  name: string;
  phase: GalleryPhase;
  canStep: boolean;
  offerMore: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  if (!canStep && !offerMore) return null;
  const busy = phase === "loading";
  return (
    <div
      role="group"
      aria-label={`${name} photos`}
      className="gallery-controls"
      // Arrow keys inside the group move between photos and never reach the deck's
      // global Pass / Save shortcuts.
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.stopPropagation();
        onStep(event.key === "ArrowRight" ? 1 : -1);
      }}
    >
      {canStep && (
        <button type="button" className="gallery-step gallery-step-prev" onClick={() => onStep(-1)}
          aria-label="Previous photo">
          <MaterialIcon name="chevron_left" />
        </button>
      )}
      <button type="button" className="gallery-step gallery-step-next" onClick={() => onStep(1)}
        aria-label={canStep ? "Next photo" : phase === "error" ? `Try again to load more photos of ${name}` : `Show more photos of ${name}`}
        aria-busy={busy || undefined} data-busy={busy || undefined}>
        <MaterialIcon name={busy ? "progress_activity" : phase === "error" && !canStep ? "refresh" : "chevron_right"} />
      </button>
    </div>
  );
}

/** Position marks. Decorative: the live region announces "Photo 2 of 3". */
export function GalleryIndicator({ count, index }: { count: number; index: number }) {
  if (count < 2) return null;
  return (
    <div aria-hidden className="gallery-indicator">
      {Array.from({ length: count }, (_, i) => <span key={i} data-active={i === index || undefined} />)}
    </div>
  );
}
