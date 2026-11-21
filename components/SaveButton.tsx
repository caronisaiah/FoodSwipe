"use client";

import { useRef, useState } from "react";
import { useFavorites } from "@/lib/storage";
import { describeStorageFailure, type StorageNotice } from "@/lib/storageErrors";
import type { Restaurant } from "@/lib/types";
import BookmarkToggle from "@/components/BookmarkToggle";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

/** Toggle the independent favorite without changing discovery history. */
export default function SaveButton({ restaurant, variant = "legacy" }: {
  restaurant: Restaurant;
  /** "editorial": Profile v2 (light page, icon plus label, no pill). */
  variant?: "legacy" | "editorial";
}) {
  const { favorites, status, error: storageError, saveFavorite, removeFavorite, retry } = useFavorites();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<StorageNotice | null>(null);
  const saved = favorites.some(({ restaurantId }) => restaurantId === restaurant.id);

  // One write at a time, even for two presses in the same frame (state would not have updated yet).
  const inFlight = useRef(false);
  const toggleSaved = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setActionError(null);
    const context = restaurantAnalyticsContext(restaurant, "standalone_profile");
    try {
      if (saved) {
        if (await removeFavorite(restaurant.id)) {
          captureFoodSwipeEvent("restaurant_unsaved", { ...context, unsaveSource: "profile_button" });
        }
      } else if (await saveFavorite(restaurant.id)) {
        captureFoodSwipeEvent("restaurant_saved", { ...context, saveSource: "profile_button" });
      }
    } catch (error) {
      setActionError(describeStorageFailure(error, saved ? "remove" : "save"));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const notice = actionError ?? (status === "error"
    ? describeStorageFailure(storageError ?? { reason: "read-failed", operation: "read" }, "load")
    : null);

  return (
    <>
      {notice && (
        <div className={variant === "editorial" ? "profile-notice" : "text-xs text-haze"}>
          <span role="alert">{notice.message}</span>
          {status === "error" && notice.retry && (
            <button type="button" className="ml-1 underline" onClick={() => void retry()}>Retry</button>
          )}
          {notice.reload && (
            <button type="button" className="ml-1 underline" onClick={() => window.location.reload()}>Reload</button>
          )}
        </div>
      )}
      {variant === "editorial" ? (
        <BookmarkToggle identity={restaurant.id} name={restaurant.name} saved={saved} pending={pending}
          unavailable={status !== "ready"} onToggle={() => void toggleSaved()} className="profile-action" />
      ) : (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void toggleSaved()}
        disabled={pending || status !== "ready"}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition active:scale-95 ${
          saved
            ? "bg-mint/15 text-mint ring-mint/30"
            : "bg-white/10 text-cream ring-white/15 hover:bg-white/20"
        }`}
      >
        <span aria-hidden>{saved ? "♥" : "♡"}</span>
        {saved ? "Saved" : "Save"}
      </button>
      )}
    </>
  );
}
