import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import RestaurantProfile from "@/components/RestaurantProfile";
import { parseProfileOrigin } from "@/lib/profileOrigin";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { getActiveVideos, isDbConfigured } from "@/lib/db/videos";
import type { Video } from "@/lib/types";

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

/**
 * The videos attached to this restaurant, read with the page so the reviews are in the first paint. This is
 * the same read-only query as GET /api/restaurants/[id]/videos. If it cannot answer quickly (no database,
 * a slow or failing query) it returns null and the browser asks the API, exactly as before.
 */
async function getInitialVideos(id: string): Promise<Video[] | null> {
  if (!isDbConfigured()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getActiveVideos(id),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1500);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

  const initialVideos = await getInitialVideos(restaurant.id);

  // `from` is only ever one of a few known words; anything else is ignored.
  return (
    <RestaurantProfile
      restaurant={restaurant}
      origin={parseProfileOrigin(Array.isArray(from) ? from[0] : from)}
      initialVideos={initialVideos}
    />
  );
}
