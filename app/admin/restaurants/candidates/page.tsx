import type { Metadata } from "next";
import AdminCandidates from "@/components/AdminCandidates";

// Internal review tool — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Restaurant candidates (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminCandidatesPage() {
  return <AdminCandidates />;
}
