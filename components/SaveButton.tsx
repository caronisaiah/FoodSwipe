"use client";

import { useSwipes } from "@/lib/storage";
import type { Restaurant } from "@/lib/types";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

/** Heart toggle that saves/un-saves a restaurant (mirrors a right swipe). */
export default function SaveButton({ restaurant }: { restaurant: Restaurant }) {
  const { savedIds, recordSwipe, removeSwipe } = useSwipes();
  const saved = savedIds.includes(restaurant.id);

  const toggleSaved = () => {
    const context = restaurantAnalyticsContext(restaurant, "standalone_profile");
    if (saved) {
      removeSwipe(restaurant.id);
      captureFoodSwipeEvent("restaurant_unsaved", {
        ...context,
        unsaveSource: "profile_button",
      });
      return;
    }

    recordSwipe(restaurant.id, "right");
    captureFoodSwipeEvent("restaurant_saved", {
      ...context,
      saveSource: "profile_button",
    });
  };

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={toggleSaved}
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
  );
}
