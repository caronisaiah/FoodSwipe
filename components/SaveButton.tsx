"use client";

import { useState } from "react";
import { useFavorites } from "@/lib/storage";
import type { Restaurant } from "@/lib/types";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

/** Toggle the independent favorite without changing discovery history. */
export default function SaveButton({ restaurant }: { restaurant: Restaurant }) {
  const { favorites, status, saveFavorite, removeFavorite, retry } = useFavorites();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const saved = favorites.some(({ restaurantId }) => restaurantId === restaurant.id);

  const toggleSaved = async () => {
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
    } catch {
      setActionError(saved ? "Couldn’t remove this favorite." : "Couldn’t save this restaurant.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {(actionError || status === "error") && (
        <div className="text-xs text-haze">
          <span role="alert">{actionError ?? "Couldn’t access favorites."}</span>
          {status === "error" && (
            <button type="button" className="ml-1 underline" onClick={() => void retry()}>Retry</button>
          )}
        </div>
      )}
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
    </>
  );
}
