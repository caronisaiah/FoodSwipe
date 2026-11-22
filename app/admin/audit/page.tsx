import type { Metadata } from "next";
import AdminAuditLog from "@/components/AdminAuditLog";

// Internal audit history — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Audit history (internal) · FoodSwipe",
  robots: { index: false, follow: false },
};

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resource = typeof params.resource === "string" ? params.resource.slice(0, 200) : "";
  return <AdminAuditLog initialResource={resource} />;
}
