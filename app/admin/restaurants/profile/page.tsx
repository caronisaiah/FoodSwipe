import type { Metadata } from "next";
import AdminProfileEditor from "@/components/AdminProfileEditor";

// Internal profile editor — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Profile editor (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default function AdminProfileEditorPage() {
  return <AdminProfileEditor />;
}
