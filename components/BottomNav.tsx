"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSwipes } from "@/lib/storage";
import MaterialIcon from "@/components/MaterialIcon";

// Three real destinations (no fake Activity/Profile tabs). "Discover" is the feed.
const TABS = [
  { href: "/feed", label: "Discover", icon: "explore" },
  { href: "/saved", label: "Saved", icon: "bookmark" },
  { href: "/", label: "Tune", icon: "tune" },
] as const;

/** Persistent glassy bottom navigation (Stitch direction). */
export default function BottomNav() {
  const pathname = usePathname();
  const { savedIds } = useSwipes();

  return (
    <nav className="sticky bottom-0 z-30 border-t border-white/10 bg-[#131313]/85 shadow-[0_-4px_20px_rgba(255,184,111,0.05)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
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
              className={`relative flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-bold tracking-tight transition-all duration-300 ease-out ${
                active
                  ? "scale-110 text-[#ffc082]"
                  : "text-[#dbc2ad]/60 hover:text-[#ffc082]/80"
              }`}
            >
              <MaterialIcon name={tab.icon} className="text-[26px]" filled={active} />
              {tab.label}
              {showBadge && (
                <span
                  aria-label={`${savedIds.length} saved`}
                  className="absolute right-1/2 top-0 translate-x-4 rounded-full bg-[#ffc082] px-1.5 text-[10px] font-bold leading-4 text-[#241200]"
                >
                  {savedIds.length}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
