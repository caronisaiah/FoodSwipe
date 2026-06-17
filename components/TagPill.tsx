import type { ReactNode } from "react";

type TagVariant = "cuisine" | "vibe" | "dietary" | "neutral";

const VARIANT_STYLES: Record<TagVariant, string> = {
  cuisine: "bg-coral/15 text-coral ring-coral/25",
  vibe: "bg-pink/15 text-pink ring-pink/25",
  dietary: "bg-mint/15 text-mint ring-mint/25",
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
