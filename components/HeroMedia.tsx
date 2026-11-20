"use client";

import { useState } from "react";

/** The covered card is inert throughout a drag. Its Google image and source
 * become available together once promoted to the interactive hero. */
export default function HeroMedia({ name, logoSrc }: { name: string; logoSrc?: string | null }) {
  const [failedLogo, setFailedLogo] = useState<string>();
  // Tier 2 — brand logo on a clean centered card.
  if (logoSrc && failedLogo !== logoSrc) {
    return (
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-gradient-to-b from-[#1a160f] to-[#0b0b0d]"
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center p-10">
          <div
            className="flex aspect-square w-1/2 max-w-[180px] items-center justify-center rounded-3xl bg-white p-6 shadow-2xl shadow-black/40 ring-1 ring-inset ring-white/10"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the logo loads
                directly from Logo.dev's CDN; never downloaded/cropped/rehosted, so a
                plain object-contain <img> is the correct, policy-safe choice here. */}
            <img
              src={logoSrc}
              alt={`${name} logo`}
              className="h-full w-full object-contain"
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailedLogo(logoSrc)}
            />
          </div>
        </div>
      </div>
    );
  }

  return <NeutralMediaBackdrop />;
}

function NeutralMediaBackdrop() {
  return (
    <div
      className="absolute inset-0 bg-[radial-gradient(120%_80%_at_22%_12%,rgba(255,192,130,0.2)_0%,transparent_52%),radial-gradient(105%_85%_at_82%_86%,rgba(214,4,47,0.14)_0%,transparent_50%),linear-gradient(155deg,#171515_0%,#101014_58%,#0b0b0d_100%)]"
      aria-hidden
    />
  );
}
