import type { Metadata } from "next";
import AdminRestaurantReview from "@/components/AdminRestaurantReview";

// Internal review workspace for ONE restaurant candidate, addressed by its stable id. Keep it out of search indexes.
export const metadata: Metadata = {
  title: "Restaurant review (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default async function AdminRestaurantReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminRestaurantReview candidateId={id.slice(0, 200)} />;
}
