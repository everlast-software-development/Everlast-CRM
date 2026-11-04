import { redirect } from "next/navigation";
import { SEGMENTS_ENABLED } from "@/lib/features";

// Segments are switched off for now (lib/features): an old link or bookmark
// lands on Contacts instead.
export default function SegmentsLayout({ children }: { children: React.ReactNode }) {
  if (!SEGMENTS_ENABLED) redirect("/customers");
  return children;
}
