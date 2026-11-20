"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PlacePhotoAttribution, { usePlacePhotoImage } from "@/components/PlacePhotoAttribution";
import MaterialIcon from "@/components/MaterialIcon";
import { normalizeClientHeroMedia, type ClientHeroMedia } from "@/lib/clientHeroMedia";
import { getMarketDisplayName } from "@/lib/markets";
import { priceLabel } from "@/lib/options";
import type { SavedRestaurant } from "@/lib/types";

function useSavedMedia(restaurant: SavedRestaurant | null, featured: boolean) {
  const frame = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [media, setMedia] = useState<ClientHeroMedia | null>(null);
  const id = restaurant?.id;
  const shouldLoad = featured || nearViewport;

  useEffect(() => {
    if (!id || shouldLoad || !frame.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [id, shouldLoad]);

  useEffect(() => {
    if (!id || !shouldLoad || media) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/restaurants/${encodeURIComponent(id)}/photo`, { signal: controller.signal });
        const data: unknown = response.ok ? await response.json() : null;
        if (!controller.signal.aborted) setMedia(normalizeClientHeroMedia(id, data));
      } catch {
        if (!controller.signal.aborted) setMedia(normalizeClientHeroMedia(id, null));
      }
    })();
    return () => controller.abort();
  }, [id, media, shouldLoad]);

  return { frame, media };
}

export default function SavedRestaurantItem({
  id,
  restaurant,
  featureLabel,
  reduceMotion,
  busy,
  removeRef,
  onRemove,
}: {
  id: string;
  restaurant: SavedRestaurant | null;
  featureLabel?: string;
  reduceMotion: boolean;
  busy: boolean;
  removeRef: (button: HTMLButtonElement | null) => void;
  onRemove: (button: HTMLButtonElement) => void;
}) {
  const featured = Boolean(featureLabel);
  const { frame, media } = useSavedMedia(restaurant, featured);
  const image = usePlacePhotoImage(media?.photo);
  const [failedLogo, setFailedLogo] = useState<string>();
  const photo = image.photo;
  const logo = media?.logoUrl !== failedLogo ? media?.logoUrl : null;
  const name = restaurant?.name ?? "Restaurant unavailable";
  const href = restaurant ? `/restaurants/${encodeURIComponent(restaurant.id)}` : undefined;

  return (
    <motion.li
      layout={reduceMotion ? false : "position"}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className={`saved-item ${featured ? "saved-feature" : "saved-row"}`}
    >
      <div ref={frame} className="saved-photo">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Google Place photos must load from their original URL.
          <img key={image.key} {...image.imageProps} src={photo.photoUri} alt="" loading={featured ? "eager" : "lazy"} decoding="async" />
        ) : logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Logo.dev assets load directly from their original URL.
          <img className="saved-logo" src={logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={() => setFailedLogo(logo)} />
        ) : (
          <span className="saved-photo-placeholder">
            <MaterialIcon name={restaurant ? "restaurant" : "hide_image"} />
            {featured && media && <span>Photo unavailable</span>}
          </span>
        )}
      </div>
      <div className="saved-item-copy">
        {featureLabel && <p className="saved-feature-label"><MaterialIcon name="schedule" /> {featureLabel}</p>}
        <h2>{href && !featured ? <Link href={href} prefetch={false}>{name}</Link> : name}</h2>
        {restaurant ? (
          <p className="saved-meta">
            {[restaurant.neighborhood, getMarketDisplayName(restaurant.market)].filter(Boolean).join(", ")}
            {" "}<strong>{priceLabel(restaurant.priceLevel)}</strong>
          </p>
        ) : (
          <p className="saved-meta">Saved reference: {id}</p>
        )}
        <div className="saved-item-links">
          {href && featured && <Link className="saved-profile-link" href={href} prefetch={false}>
            View profile <MaterialIcon name="arrow_forward" />
          </Link>}
        </div>
        {image.displayed && <PlacePhotoAttribution photo={image.displayed} subject={name} light />}
      </div>
      <button
        ref={removeRef}
        type="button"
        className="editorial-icon-button saved-remove"
        aria-label={restaurant ? `Remove ${name} from Saved` : `Remove unavailable favorite ${id} from Saved`}
        aria-disabled={busy || undefined}
        onClick={(event) => onRemove(event.currentTarget)}
      ><MaterialIcon name="bookmark_remove" /></button>
    </motion.li>
  );
}
