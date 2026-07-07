import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import RestaurantProfile from "@/components/RestaurantProfile";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";

// Pre-render seed restaurants only when content mode allows seeds. Published DB
// restaurants are not listed here, so their pages render on demand.
export function generateStaticParams() {
  if (!shouldIncludeSeedRestaurants()) return [];
  return RESTAURANTS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = await getAppRestaurantById(id, {
    includeSeeds: shouldIncludeSeedRestaurants(),
  });
  if (!r) return { title: "Restaurant not found · FoodSwipe" };
  return {
    title: `${r.name} · FoodSwipe`,
    description: r.reasonText,
  };
}

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Seed resolution is gated by content mode; published DB rows still render on demand.
  const restaurant = await getAppRestaurantById(id, {
    includeSeeds: shouldIncludeSeedRestaurants(),
  });
  if (!restaurant) notFound();

  return (
    <AppShell>
      <RestaurantProfile restaurant={restaurant} />
    </AppShell>
  );
}
