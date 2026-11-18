"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { getMarketDisplayName, listMarkets, type Market } from "@/lib/markets";

const photos: Record<Market, {
  src: string;
  srcSet?: string;
  alt: string;
  artist: string;
  source: string;
  license: string;
  licenseUrl: string;
}> = {
  nyc: {
    src: "/media/tune/city-nyc.webp",
    srcSet: "/media/tune/city-nyc-small.webp 720w, /media/tune/city-nyc.webp 1400w",
    alt: "Restaurant and shop fronts along Doyers Street in Manhattan’s Chinatown",
    artist: "Beyond My Ken",
    source: "https://commons.wikimedia.org/wiki/File:Doyers_Street_Chinatown.jpg",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  dc: {
    src: "/media/tune/city-dc.webp",
    alt: "14th Street NW in Washington, DC at night",
    artist: "Ted Eytan",
    source: "https://commons.wikimedia.org/wiki/File:14th_from_U_Street_Night.jpg",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
  },
};

const markets = listMarkets();

function MarketDisclosure({ market }: { market: Market }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const orderedMarkets = [...markets].sort((a, b) => Number(b.id === market) - Number(a.id === market));

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      const details = disclosure.current;
      if (details && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }

    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <details
      ref={disclosure}
      className="discovery-market"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        summary.current?.focus();
      }}
      onBlur={(event) => {
        if (event.currentTarget.open && !event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary ref={summary}>
        <MaterialIcon name="location_on" />
        <span className="discovery-market-name">
          <small>Discovery market</small>
          <strong>{getMarketDisplayName(market)}</strong>
        </span>
        <MaterialIcon name="expand_more" className="discovery-market-chevron" />
      </summary>
      {open && (
        <motion.div
          className="discovery-market-panel"
          initial={reduced ? false : { opacity: 0.94, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <ul aria-label="Discovery markets">
            {orderedMarkets.map(({ id, displayName }) => (
              <li key={id} className={id === market ? "discovery-market-current" : undefined}>
                <span>{displayName}</span>
                {id === market ? <span><MaterialIcon name="check" /> Current</span> : <span>Unavailable</span>}
              </li>
            ))}
          </ul>
          <p>Market switching is currently unavailable.</p>
        </motion.div>
      )}
    </details>
  );
}

export default function DiscoveryCity({ market }: { market: Market | null }) {
  const photo = market ? photos[market] : null;
  return (
    <section className="discovery-city" aria-label="Discovery city">
      <div className="discovery-city-banner">
        {photo && (
          <figure className={`discovery-city-photo discovery-city-photo-${market}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Locally sized and licensed responsive WebP. */}
            <img
              src={photo.src}
              srcSet={photo.srcSet}
              sizes="(min-width: 1180px) 558px, (min-width: 790px) 47vw, calc(100vw - 40px)"
              alt={photo.alt}
              fetchPriority="high"
            />
            <figcaption>
              <a href={photo.source}>{photo.artist}</a>
              <span aria-hidden="true">/</span>
              <a href={photo.licenseUrl}>{photo.license}</a>
            </figcaption>
          </figure>
        )}
        <div className="discovery-city-title">
          <h1 className="editorial-page-title">Taste of the City</h1>
        </div>
      </div>
      {market ? <MarketDisclosure market={market} /> : (
        <div className="discovery-market-unavailable">
          <MaterialIcon name="location_off" />
          <strong>Discovery market unavailable</strong>
        </div>
      )}
    </section>
  );
}
