import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";

/**
 * Mobile-first frame. Constrains the app to a phone-width column (centered
 * with ambient glow on desktop) and pins the bottom nav. Used by the in-app
 * screens (feed / saved / profile); the onboarding landing renders standalone.
 */
export default function AppShell({ children, wide = false, tone }: {
  children: ReactNode;
  wide?: boolean;
  /** "media": the dark editorial media canvas used by Swipe v2. */
  tone?: "media";
}) {
  return (
    <div data-tone={tone} className={`mx-auto flex h-dvh w-full flex-col overflow-hidden border-white/5 bg-ink/40 md:border-x ${wide ? "max-w-5xl" : "max-w-md"}`}>
      {/* pad for the notch / status bar (0 on devices without one) */}
      <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
