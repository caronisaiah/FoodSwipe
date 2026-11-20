"use client";

import { useState } from "react";
import type { PlacePhoto } from "@/lib/placePhoto";
import MaterialIcon from "@/components/MaterialIcon";
import styles from "./PlacePhotoAttribution.module.css";

/** Keep the directly loaded image and its caption on the same load/error boundary. */
export function usePlacePhotoImage(photo: PlacePhoto | null | undefined) {
  const key = photo ? JSON.stringify([photo.photoUri, photo.googleMapsUri]) : null;
  type ImageState = "loading" | "loaded" | "failed";
  const [result, setResult] = useState<{ key: string | null; state: ImageState }>({ key, state: "loading" });
  if (result.key !== key) setResult({ key, state: "loading" });
  const loaded = result.key === key && result.state === "loaded";
  function settle(state: ImageState) {
    setResult((current) => current.key === key ? { key, state } : current);
  }
  return {
    photo: result.key === key && result.state === "failed" ? null : photo,
    displayed: loaded ? photo : null,
    key,
    imageProps: {
      style: { visibility: loaded ? "visible" as const : "hidden" as const },
      onLoad: () => settle("loaded"),
      onError: () => settle("failed"),
      referrerPolicy: "no-referrer" as const,
    },
  };
}

export default function PlacePhotoAttribution({ photo, subject, light = false }: {
  photo: PlacePhoto;
  subject: string;
  light?: boolean;
}) {
  return (
    <div className={styles.credit} data-surface={light ? "light" : "dark"}
      role="group" aria-label={`Photo attribution for ${subject}`}
      onPointerDownCapture={(event) => { if ((event.target as Element).closest("a")) event.stopPropagation(); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation();
      }}>
      <a className={styles.source} href={photo.googleMapsUri} target="_blank" rel="noopener noreferrer"
        aria-label={`View photo of ${subject} on Google Maps (opens in a new tab)`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Unmodified official provider mark. */}
        <img src={light ? "/attribution/google-maps-dark.png" : "/attribution/google-maps-white.png"}
          width="98" height="18" alt="Google Maps" />
        <MaterialIcon name="open_in_new" />
      </a>
      {photo.attributions.map((author, index) => {
        const text = <>
          {author.photoUri && (
            // eslint-disable-next-line @next/next/no-img-element -- Author avatar is supplied by the provider.
            <img className={styles.avatar} src={author.photoUri} alt="" loading="lazy" referrerPolicy="no-referrer"
              key={author.photoUri} onError={(event) => { event.currentTarget.hidden = true; }} />
          )}
          <span>{author.displayName}</span>
        </>;
        return author.uri ? (
          <a className={styles.author} key={index} href={author.uri} target="_blank" rel="noopener noreferrer"
            aria-label={`${author.displayName}, photographer profile (opens in a new tab)`}>{text}</a>
        ) : <span className={styles.author} key={index}>{text}</span>;
      })}
    </div>
  );
}
