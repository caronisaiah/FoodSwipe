import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import AppShell from "@/components/AppShell";
import RestaurantProfile from "@/components/RestaurantProfile";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";

// Publication status can change between requests. Metadata and the page share
// one visibility check within a request.
export const dynamic = "force-dynamic";
const getProfile = cache((id: string) =>
  getAppRestaurantById(id, { includeSeeds: shouldIncludeSeedRestaurants() }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const r = await getProfile(id);
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
  const restaurant = await getProfile(id);
  if (!restaurant) notFound();

  return (
    <AppShell>
      <RestaurantProfile restaurant={restaurant} />
    </AppShell>
  );
}
