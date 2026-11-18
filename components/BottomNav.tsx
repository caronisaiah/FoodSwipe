"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFavorites } from "@/lib/storage";
import MaterialIcon from "@/components/MaterialIcon";

// Discover groups the swipe feed and the restaurant map.
const TABS = [
  { href: "/feed", label: "Discover", icon: "explore" },
  { href: "/saved", label: "Saved", icon: "bookmark" },
  { href: "/", label: "Tune", icon: "tune" },
] as const;

/** Shared destination rail. Tune places it in the masthead at desktop widths. */
export default function BottomNav() {
  const pathname = usePathname();
  const { favorites } = useFavorites();

  return (
    <nav className="foodswipe-nav" aria-label="Primary">
      <div className="foodswipe-nav-links">
        {TABS.map((tab) => {
          const inMap = pathname === "/map" && tab.href === "/feed";
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href) || inMap;
          const showBadge = tab.href === "/saved" && favorites.length > 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={inMap ? "location" : active ? "page" : undefined}
              className="foodswipe-nav-link"
            >
              <MaterialIcon name={tab.icon} filled={active} />
              <span>{tab.label}</span>
              {showBadge && (
                <span className="foodswipe-nav-count">
                  {favorites.length}<span className="sr-only"> saved {favorites.length === 1 ? "restaurant" : "restaurants"}</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
