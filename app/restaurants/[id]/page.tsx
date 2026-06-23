import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import RestaurantProfile from "@/components/RestaurantProfile";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAppRestaurantById } from "@/lib/db/restaurants";

// Pre-render every seeded restaurant at build time. Published DB restaurants are
// not listed here, so their pages render on demand (dynamicParams default = true).
export function generateStaticParams() {
  return RESTAURANTS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = await getAppRestaurantById(id);
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
  // Seed resolves synchronously; an unknown id falls through to the published DB.
  const restaurant = await getAppRestaurantById(id);
  if (!restaurant) notFound();

  return (
    <AppShell>
      <RestaurantProfile restaurant={restaurant} />
    </AppShell>
  );
}
