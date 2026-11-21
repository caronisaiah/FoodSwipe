import { captureFoodSwipeEvent, restaurantAnalyticsContext } from "@/lib/analytics";
import { getMarketShortName } from "@/lib/markets";
import type { Restaurant } from "@/lib/types";

/**
 * Share a restaurant's canonical public profile link: the native share sheet when there is one, otherwise the
 * clipboard. The link never carries navigation state (no `?from=`). Resolves to what happened so the caller can say so.
 */
export async function shareRestaurantProfile(restaurant: Restaurant): Promise<"shared" | "copied" | "dismissed" | "failed"> {
  const url = `${window.location.origin}/restaurants/${encodeURIComponent(restaurant.id)}`;
  const context = restaurantAnalyticsContext(restaurant, "standalone_profile");
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({
        title: restaurant.name,
        text: `${restaurant.name} — ${restaurant.neighborhood || getMarketShortName(restaurant.market)}`,
        url,
      });
      captureFoodSwipeEvent("restaurant_shared", { ...context, method: "native" });
      return "shared";
    }
  } catch (error) {
    // Dismissing the native sheet is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
  }
  try {
    await navigator.clipboard.writeText(url);
    captureFoodSwipeEvent("restaurant_shared", { ...context, method: "clipboard" });
    return "copied";
  } catch {
    return "failed";
  }
}
