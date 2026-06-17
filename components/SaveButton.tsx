"use client";

import { useSwipes } from "@/lib/storage";

/** Heart toggle that saves/un-saves a restaurant (mirrors a right swipe). */
export default function SaveButton({ restaurantId }: { restaurantId: string }) {
  const { savedIds, recordSwipe, removeSwipe } = useSwipes();
  const saved = savedIds.includes(restaurantId);

  return (
    <button
      type="button"
      onClick={() =>
        saved ? removeSwipe(restaurantId) : recordSwipe(restaurantId, "right")
      }
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
