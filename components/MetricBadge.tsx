import type { ReactNode } from "react";

interface MetricBadgeProps {
  /** Emoji or icon node. */
  icon: ReactNode;
  /** Big value, pre-formatted (e.g. "88", "1.8k"). */
  value: ReactNode;
  /** Small caption under the value. */
  label: string;
  /** Optional accent color class for the value text. */
  accentClassName?: string;
}

/** Compact stat tile used on the restaurant profile's social-proof row. */
export default function MetricBadge({
  icon,
  value,
  label,
  accentClassName = "text-cream",
}: MetricBadgeProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface px-2 py-3 text-center ring-1 ring-inset ring-white/5">
      <span className="text-lg leading-none" aria-hidden>
        {icon}
      </span>
      <span className={`mt-1.5 font-display text-lg font-bold leading-none ${accentClassName}`}>
        {value}
      </span>
      <span className="mt-1 text-[11px] font-medium leading-tight text-haze">
        {label}
      </span>
    </div>
  );
}

/** Format large counts compactly: 1840 -> "1.8k". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}
