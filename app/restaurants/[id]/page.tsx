import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import RestaurantProfile from "@/components/RestaurantProfile";
import { parseProfileOrigin } from "@/lib/profileOrigin";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";

// Publication status can change between requests. Metadata and the page share
// one visibility check within a request.
export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  themeColor: "#f8f1e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const restaurant = await getProfile(id);
  if (!restaurant) notFound();

  // `from` is only ever one of a few known words; anything else is ignored.
  return <RestaurantProfile restaurant={restaurant} origin={parseProfileOrigin(Array.isArray(from) ? from[0] : from)} />;
}
