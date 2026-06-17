import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import RestaurantProfile from "@/components/RestaurantProfile";
import { RESTAURANTS, getRestaurantById } from "@/lib/seed/restaurants";

// Pre-render every seeded restaurant at build time.
export function generateStaticParams() {
  return RESTAURANTS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = getRestaurantById(id);
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
  const restaurant = getRestaurantById(id);
  if (!restaurant) notFound();

  return (
    <AppShell>
      <RestaurantProfile restaurant={restaurant} />
    </AppShell>
  );
}
