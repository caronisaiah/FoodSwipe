import type { Metadata } from "next";
import AdminVideoCandidates from "@/components/AdminVideoCandidates";

// Internal review console — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Video candidates (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminVideoCandidatesPage() {
  return <AdminVideoCandidates />;
}
