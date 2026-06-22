import Link from "next/link";
import AppShell from "@/components/AppShell";

export default function RestaurantNotFound() {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="text-5xl">🍽️</span>
        <h1 className="font-display text-2xl font-bold text-cream">
          We couldn&apos;t find that spot
        </h1>
        <p className="text-sm text-haze">It may have left the deck.</p>
        <Link
          href="/feed"
          className="rounded-full bg-brand-gradient px-6 py-3 font-semibold text-saffron-ink shadow-lg shadow-saffron/20"
        >
          Back to swiping →
        </Link>
      </div>
    </AppShell>
  );
}
