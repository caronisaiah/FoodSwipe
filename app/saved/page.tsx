import type { Viewport } from "next";
import SavedClient from "@/components/SavedClient";

export const viewport: Viewport = {
  themeColor: "#f8f1e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function SavedPage() {
  return <SavedClient />;
}
