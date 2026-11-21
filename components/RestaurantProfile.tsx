"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Restaurant } from "@/lib/types";
import EditorialHeader from "@/components/editorial/EditorialHeader";
import RestaurantHero from "@/components/RestaurantHero";
import CreatorReviews from "@/components/CreatorReviews";
import { useRestaurantProfileVideos } from "@/components/RestaurantVideos";
import { websiteUrl } from "@/components/GoThere";
import SaveButton from "@/components/SaveButton";
import MaterialIcon from "@/components/MaterialIcon";
import { captureFoodSwipeEvent, restaurantAnalyticsContext } from "@/lib/analytics";
import { cuisineEmoji } from "@/lib/emoji";
import { directionsUrl } from "@/lib/mapLocations";
import { armMapReturn } from "@/lib/mapReturnState";
import { PROFILE_ORIGINS as ORIGINS, type ProfileOrigin } from "@/lib/profileOrigin";
import { shareRestaurantProfile } from "@/lib/shareRestaurant";
import { useVisibleOnce } from "@/lib/useVisibleOnce";

/**
 * The one standalone restaurant profile, `/restaurants/[slug]`, whether it was opened from Map, Saved, Swipe or a
 * link. It shares the editorial identity and the Phase 13 photo gallery with Swipe's card, in its own page layout.
 */
export default function RestaurantProfile({ restaurant: r, origin }: { restaurant: Restaurant; origin: ProfileOrigin | null }) {
  const router = useRouter();
  const page = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const [shareStatus, setShareStatus] = useState("");
  const { videos } = useRestaurantProfileVideos({ restaurantId: r.id, seedVideos: r.videos });
  const context = restaurantAnalyticsContext(r, "standalone_profile");
  const poster = cuisineEmoji(r.cuisineTags);
  const website = websiteUrl(r.websiteDomain);
  const eyebrow = [r.cuisineTags[0], r.neighborhood.trim()].filter(Boolean).join(" · ");

  const engaged = useVisibleOnce<HTMLElement>(() => captureFoodSwipeEvent("profile_engaged", context));
  const orderRef = useVisibleOnce<HTMLElement>(() => captureFoodSwipeEvent("profile_depth_reached", { ...context, milestone: "what_to_order" }));
  const visitRef = useVisibleOnce<HTMLElement>(() => captureFoodSwipeEvent("profile_depth_reached", { ...context, milestone: "go_there" }));

  // The bottom navigation grows with text size; keep the page's bottom padding equal to its real height.
  useEffect(() => {
    const container = page.current;
    const rail = navigation.current;
    if (!container || !rail) return;
    const observer = new ResizeObserver(() => container.style.setProperty("--profile-footer-height", `${rail.offsetHeight}px`));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  // Browser Back or Forward from a Map-opened profile also puts the Map back as it was. Browsers with the
  // Navigation API announce the traversal before Next unmounts this page; the others fire popstate.
  useEffect(() => {
    if (origin !== "map") return;
    const arm = () => armMapReturn(r.id);
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const onNavigate = (event: Event) => { if ((event as Event & { navigationType?: string }).navigationType === "traverse") arm(); };
    navigation?.addEventListener("navigate", onNavigate);
    // Capture phase: Next handles the same event and may unmount this page before a bubbling listener would run.
    window.addEventListener("popstate", arm, true);
    return () => {
      navigation?.removeEventListener("navigate", onNavigate);
      window.removeEventListener("popstate", arm, true);
    };
  }, [origin, r.id]);

  function goBack() {
    if (!origin) return;
    if (origin === "map") armMapReturn(r.id);
    // A real history entry exists when they arrived from the app; otherwise go to where they came from.
    if (window.history.length > 1) router.back();
    else router.push(ORIGINS[origin].href);
  }

  async function share() {
    const result = await shareRestaurantProfile(r);
    setShareStatus(result === "copied" ? "Profile link copied." : result === "failed" ? "Couldn’t share this profile." : "");
    if (result === "copied") window.setTimeout(() => setShareStatus(""), 2500);
  }

  return (
    <div ref={page} className="editorial-canvas profile-page">
      <EditorialHeader
        skipTo="profile-title"
        skipLabel="Skip to the restaurant profile"
        navigationRef={navigation}
        trailing={<Link href="/feed" className="map-swipe-link">Swipe view</Link>}
      />
      <main className="profile-layout">
        <div className="profile-return">
          {origin ? (
            <button type="button" className="profile-action" onClick={goBack}>
              <MaterialIcon name="arrow_back" /> Back to {ORIGINS[origin].label}
            </button>
          ) : (
            <Link href="/feed" className="profile-action"><MaterialIcon name="arrow_back" /> Back to Swipe</Link>
          )}
          <div className="profile-actions">
            <button type="button" className="profile-action" onClick={() => void share()} aria-label="Share this restaurant profile">
              <MaterialIcon name={shareStatus.startsWith("Profile link") ? "check" : "ios_share"} />
              <span className="profile-share-label">{shareStatus.startsWith("Profile link") ? "Copied" : "Share"}</span>
            </button>
            <SaveButton restaurant={r} variant="editorial" />
          </div>
        </div>
        <p role="status" className="sr-only">{shareStatus}</p>

        <header ref={engaged} className="profile-head">
          {eyebrow && <p className="editorial-eyebrow">{eyebrow}</p>}
          <h1 id="profile-title" tabIndex={-1} className="editorial-page-title">{r.name}</h1>
        </header>

        <div className="profile-grid">
          <div className="profile-media">
            <RestaurantHero
              restaurantId={r.id}
              fallbackVideo={r.videos[0]}
              posterEmoji={poster}
              name={r.name}
              neighborhood={r.neighborhood}
              distanceMiles={r.distanceMiles}
              priceLevel={r.priceLevel}
              variant="profile"
            />
          </div>
          <div className="profile-copy">
            {videos.length > 0 && (
              <section aria-labelledby="profile-reviews-title" className="profile-section">
                <h2 id="profile-reviews-title" className="editorial-section-title">Creator reviews</h2>
                <CreatorReviews items={videos} analytics={context} posterEmoji={poster} />
              </section>
            )}
            {r.dishHighlights.length > 0 && (
              <section ref={orderRef} aria-labelledby="profile-order-title" className="profile-section">
                <h2 id="profile-order-title" className="editorial-section-title">What to order</h2>
                <p>{r.dishHighlights.join(" · ")}</p>
              </section>
            )}
            <section ref={visitRef} aria-labelledby="profile-visit-title" className="profile-section">
              <h2 id="profile-visit-title" className="editorial-section-title">Visit</h2>
              {r.address && <p>{r.address}</p>}
              <div className="profile-links">
                <a className="profile-text-action" href={directionsUrl({ name: r.name, address: r.address || null })} target="_blank"
                  rel="noopener noreferrer" aria-label={`Directions to ${r.name} (opens in a new tab)`}
                  onClick={() => captureFoodSwipeEvent("directions_clicked", context)}>
                  Directions <MaterialIcon name="arrow_outward" />
                </a>
                {website && (
                  <a className="profile-text-action" href={website} target="_blank" rel="noopener noreferrer"
                    aria-label={`${r.name} website (opens in a new tab)`} onClick={() => captureFoodSwipeEvent("website_clicked", context)}>
                    Website <MaterialIcon name="arrow_outward" />
                  </a>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
