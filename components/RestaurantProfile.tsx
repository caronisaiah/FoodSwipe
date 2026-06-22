import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import SaveButton from "@/components/SaveButton";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Full-page restaurant profile for the standalone `/restaurants/[id]` route
 * (direct links / SEO). The actual content lives in the shared
 * `RestaurantProfileView`; this wrapper only adds the page chrome (scroll
 * container + sticky back-to-feed bar + save). The /feed deck renders the same
 * `RestaurantProfileView` (feed variant) directly as the scrollable card body.
 */
export default function RestaurantProfile({
  restaurant: r,
}: {
  restaurant: Restaurant;
}) {
  return (
    <div className="no-scrollbar flex-1 overflow-y-auto pb-10">
      {/* Top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink/70 px-4 py-3 backdrop-blur-lg">
        <Link
          href="/feed"
          aria-label="Back to feed"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20"
        >
          <MaterialIcon name="arrow_back" className="text-xl" />
        </Link>
        <SaveButton restaurantId={r.id} />
      </div>

      <RestaurantProfileView restaurant={r} />
    </div>
  );
}
