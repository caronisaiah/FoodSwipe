import type { ReactNode } from "react";

type TagVariant = "cuisine" | "vibe" | "dietary" | "neutral";

const VARIANT_STYLES: Record<TagVariant, string> = {
  cuisine: "bg-saffron/14 text-saffron ring-saffron/28",
  vibe: "bg-tan/12 text-tan ring-tan/22",
  dietary: "bg-mint/12 text-[#7fe3b0] ring-mint/22",
  neutral: "bg-white/8 text-haze ring-white/10",
};

interface TagPillProps {
  children: ReactNode;
  variant?: TagVariant;
  emoji?: string;
  className?: string;
}

/** Small rounded chip used for cuisine / vibe / dietary tags. */
export default function TagPill({
  children,
  variant = "neutral",
  emoji,
  className = "",
}: TagPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${VARIANT_STYLES[variant]} ${className}`}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {children}
    </span>
  );
}
