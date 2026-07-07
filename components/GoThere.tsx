"use client";

import MaterialIcon from "@/components/MaterialIcon";

/**
 * Polished public "Go there" module. It receives already-resolved URLs from the
 * profile body, so it does not refetch video sources or invent unavailable links.
 */
export default function GoThere({
  directionsUrl,
  websiteDomain,
  reviewsHref,
}: {
  directionsUrl: string;
  websiteDomain?: string | null;
  reviewsHref?: string;
}) {
  const websiteHref = websiteUrl(websiteDomain);

  return (
    <section className="rounded-[24px] bg-surface px-4 py-[18px] pb-5 ring-1 ring-inset ring-white/5">
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-haze">
        Go there
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <ExternalTile href={directionsUrl} icon="near_me" label="Directions" primary />
        <ExternalTile href={websiteHref} icon="language" label="Website" />
        <ExternalTile href={reviewsHref} icon="play_circle" label="Reviews" />
      </div>
    </section>
  );
}

function websiteUrl(domain?: string | null): string | undefined {
  const trimmed = domain?.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return undefined;
  return `https://${trimmed}`;
}

function ExternalTile({
  href,
  icon,
  label,
  primary = false,
}: {
  href?: string;
  icon: string;
  label: string;
  primary?: boolean;
}) {
  const base =
    "flex min-h-[74px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-3 text-center text-xs font-semibold ring-1 ring-inset transition";

  if (!href) {
    return (
      <span
        aria-disabled="true"
        title="Coming soon"
        onPointerDown={(e) => e.stopPropagation()}
        className={`${base} cursor-not-allowed bg-black/25 text-haze/55 ring-white/5`}
      >
        <MaterialIcon name={icon} className="text-[22px]" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      className={
        primary
          ? `${base} bg-brand-gradient text-saffron-ink ring-transparent shadow-lg shadow-saffron/20 active:scale-[0.98]`
          : `${base} bg-black/30 text-cream ring-white/10 hover:bg-surface-2 active:scale-[0.98]`
      }
    >
      <MaterialIcon name={icon} className="text-[22px]" />
      <span>{label}</span>
    </a>
  );
}
