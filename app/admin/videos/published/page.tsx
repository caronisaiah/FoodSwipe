import type { Metadata } from "next";
import AdminPublishedVideos from "@/components/AdminPublishedVideos";

// Internal tool — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Published videos (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminPublishedVideosPage() {
  return <AdminPublishedVideos />;
}
