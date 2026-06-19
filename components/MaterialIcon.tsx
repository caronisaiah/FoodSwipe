/**
 * A single Material Symbols (Outlined) icon. The font is loaded once in
 * `app/layout.tsx`; this just renders the ligature span. Decorative by default
 * (`aria-hidden`) — give the surrounding button/link an `aria-label`.
 *
 * Size follows `font-size` (set via `className`, e.g. `text-2xl`); pass
 * `filled` to switch to the solid variant.
 */
export default function MaterialIcon({
  name,
  className = "",
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}
