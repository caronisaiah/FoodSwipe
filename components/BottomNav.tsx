"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSwipes } from "@/lib/storage";

const TABS = [
  { href: "/feed", label: "Swipe", icon: "🔥" },
  { href: "/saved", label: "Saved", icon: "♥" },
  { href: "/", label: "Tune", icon: "⚙️" },
] as const;

/** Simple persistent bottom navigation for the app screens. */
export default function BottomNav() {
  const pathname = usePathname();
  const { savedIds } = useSwipes();

  return (
    <nav className="sticky bottom-0 z-30 border-t border-white/10 bg-ink/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          const showBadge = tab.href === "/saved" && savedIds.length > 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                active ? "text-cream" : "text-haze hover:text-cream/80"
              }`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {tab.icon}
              </span>
              {tab.label}
              {showBadge && (
                <span
                  aria-label={`${savedIds.length} saved`}
                  className="absolute right-1/2 top-1.5 translate-x-4 rounded-full bg-coral px-1.5 text-[10px] font-bold leading-4 text-ink"
                >
                  {savedIds.length}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-gradient" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
