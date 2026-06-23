import type { Metadata } from "next";
import AdminPublishedRestaurants from "@/components/AdminPublishedRestaurants";

// Internal editor — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Published restaurants (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminPublishedRestaurantsPage() {
  return <AdminPublishedRestaurants />;
}
