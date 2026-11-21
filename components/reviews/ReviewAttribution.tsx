import MaterialIcon from "@/components/MaterialIcon";
import type { Video } from "@/lib/types";
import { reviewCreatorName } from "@/lib/reviewMedia";
import { sourceLinkLabel, videoSourceHref } from "@/lib/video";

/**
 * Platform, creator and the original post, always outside the provider's iframe so the
 * provider's own header, controls and branding are never covered.
 */
export default function ReviewAttribution({
  video,
  demoLabel,
  onSourceClick,
}: {
  video: Video;
  /** "Demo clip" / "Local" for clips that came through the internal tool. */
  demoLabel?: string;
  onSourceClick?: () => void;
}) {
  const href = videoSourceHref(video);
  const name = reviewCreatorName(video, href);
  return (
    <p className="review-attribution">
      <span className="review-attribution-platform">{video.platform}</span>
      <strong>{name ?? "Creator not recorded"}</strong>
      {demoLabel && <span className="review-attribution-tag">{demoLabel}</span>}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={onSourceClick}
          aria-label={`${sourceLinkLabel(video)}${name ? ` by ${name}` : ""} on ${video.platform} (opens in a new tab)`}>
          {sourceLinkLabel(video)} <MaterialIcon name="arrow_outward" />
        </a>
      ) : (
        <span className="review-attribution-none">No original link</span>
      )}
    </p>
  );
}
