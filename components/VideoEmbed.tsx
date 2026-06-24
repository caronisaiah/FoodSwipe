import type { Platform, Video } from "@/lib/types";
import {
  hasUrl,
  sourceLinkLabel,
  videoCanEmbed,
  videoSourceHref,
} from "@/lib/video";

/*
  Legal-safe video display (MVP v1)
  ---------------------------------
  We NEVER download, crop, store or rehost third-party video. What we render is
  driven entirely by `video.legalDisplayStatus`, and the language is honest:

    embeddable        -> official iframe embed (needs embedUrl) + "View source"
    source-link-only  -> rich preview + a real link ("View original"/"View source")
    placeholder-only  -> rich preview, NO external link, "Source placeholder" chip
    unavailable       -> muted preview, "Source unavailable", no link

  We always surface the platform + creator credit. We never label a placeholder
  as a real post. This is the single seam for wiring real oEmbed/API embeds —
  callers don't change.
*/

const PLATFORM_META: Record<Platform, { label: string; glyph: string }> = {
  TikTok: { label: "TikTok", glyph: "♪" },
  Instagram: { label: "Instagram", glyph: "📸" },
  YouTube: { label: "YouTube", glyph: "▶" },
  Web: { label: "Web", glyph: "🌐" },
};

// Dark, on-brand gradients chosen deterministically per clip so placeholders
// feel distinct but cohesive.
const GRADIENTS = [
  "linear-gradient(150deg,#3a1726,#0e0e12 70%)",
  "linear-gradient(150deg,#2b1838,#0e0e12 70%)",
  "linear-gradient(150deg,#3a2414,#0e0e12 70%)",
  "linear-gradient(150deg,#13322a,#0e0e12 70%)",
  "linear-gradient(150deg,#341a1a,#0e0e12 70%)",
  "linear-gradient(150deg,#1c2438,#0e0e12 70%)",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface VideoEmbedProps {
  video: Video;
  /** Emoji shown in the placeholder, usually derived from cuisine. */
  posterEmoji?: string;
  /** Fill the parent (absolute). Parent must be `relative`. */
  fill?: boolean;
  className?: string;
}

export default function VideoEmbed({
  video,
  posterEmoji = "🍽️",
  fill = false,
  className = "",
}: VideoEmbedProps) {
  // Fallback guards a tampered/legacy platform value from crashing render.
  const meta = PLATFORM_META[video.platform] ?? PLATFORM_META.Web;
  const root = fill
    ? `absolute inset-0 h-full w-full ${className}`
    : `relative h-full w-full ${className}`;

  // Resolve what we can actually show, with safe fallbacks.
  const canEmbed = videoCanEmbed(video);
  const sourceHref = videoSourceHref(video);
  const unavailable = video.legalDisplayStatus === "unavailable";

  // --- Real embed path (no seed video uses this; the admin tool can) ---
  if (canEmbed) {
    return (
      <div className={root}>
        {/*
          Only official, allowlisted embeds reach here — YouTube nocookie, TikTok's
          player iframe, or Instagram's /embed/ iframe (see lib/video.isEmbedUrlAllowed,
          which validates host + exact official path). Each is the platform's own
          player (no download/rehost). We harden with referrerPolicy but intentionally
          do NOT set `sandbox`: these players need scripts + same-origin + fullscreen,
          and a sandbox permissive enough to allow those negates it — we rely on the
          allowlist instead.
        */}
        <iframe
          src={video.embedUrl}
          title={video.attributionText}
          className="h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <PlatformBadge label={meta.label} glyph={meta.glyph} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
          <Credit video={video} />
          {sourceHref && (
            <SourceLink
              href={sourceHref}
              label={sourceLinkLabel(video)}
              attribution={video.attributionText}
            />
          )}
        </div>
      </div>
    );
  }

  // --- Preview path (the normal MVP state) ---
  const background = hasUrl(video.thumbnailUrl)
    ? `center/cover no-repeat url("${video.thumbnailUrl}")`
    : GRADIENTS[hash(video.id) % GRADIENTS.length];
  const chip = statusChip(video);

  return (
    <div className={`${root} ${unavailable ? "grayscale" : ""}`}>
      <div
        className={`absolute inset-0 ${unavailable ? "opacity-50" : ""}`}
        style={{ background }}
        aria-hidden
      />
      {/* readability scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/35" />

      <PlatformBadge label={meta.label} glyph={meta.glyph} />

      {/* center poster + play affordance — decorative (real control is the link) */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3"
        aria-hidden
      >
        {!hasUrl(video.thumbnailUrl) && (
          <span className="text-6xl opacity-80 drop-shadow-lg">{posterEmoji}</span>
        )}
        {!unavailable && (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 pl-0.5 text-2xl text-white backdrop-blur-md ring-1 ring-white/25">
            ▶
          </span>
        )}
      </div>

      {/* caption + credit + source affordance */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <div className="min-w-0">
          <Credit video={video} />
          <p className="line-clamp-2 text-xs text-white/85 drop-shadow">
            {video.caption}
          </p>
        </div>
        {sourceHref ? (
          <SourceLink
            href={sourceHref}
            label={sourceLinkLabel(video)}
            attribution={video.attributionText}
          />
        ) : chip ? (
          <span
            className="shrink-0 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/80 backdrop-blur-md ring-1 ring-white/15"
            title={video.attributionText}
          >
            {chip}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Short honest status for previews that don't have a real link. */
function statusChip(video: Video): string | null {
  if (video.legalDisplayStatus === "placeholder-only") return "Source placeholder";
  if (video.legalDisplayStatus === "unavailable") return "Source unavailable";
  return null;
}

function PlatformBadge({ label, glyph }: { label: string; glyph: string }) {
  return (
    <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md ring-1 ring-white/15">
      <span aria-hidden>{glyph}</span>
      {label}
    </span>
  );
}

function Credit({ video }: { video: Video }) {
  const primary = video.creatorDisplayName ?? video.creatorHandle;
  return (
    <p className="truncate text-sm font-semibold text-white drop-shadow">
      {primary}
      {video.creatorDisplayName &&
        video.creatorHandle !== video.creatorDisplayName && (
          <span className="ml-1 font-normal text-white/70">
            {video.creatorHandle}
          </span>
        )}
    </p>
  );
}

function SourceLink({
  href,
  label,
  attribution,
}: {
  href: string;
  label: string;
  attribution: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} — ${attribution}`}
      className="pointer-events-auto shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md ring-1 ring-white/25 transition hover:bg-white/25"
    >
      {label} ↗
    </a>
  );
}
