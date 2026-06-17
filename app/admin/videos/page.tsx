import type { Metadata } from "next";
import AdminVideos from "@/components/AdminVideos";

// Internal demo tool — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Video intake (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminVideosPage() {
  return <AdminVideos />;
}
