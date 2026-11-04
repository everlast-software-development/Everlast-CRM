"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquareText, MessagesSquare, type LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";
import { SectionedLayout } from "@/components/SectionedLayout";
import { SavedRepliesPanel } from "@/components/settings/SavedRepliesPanel";
import { CareTemplatesPanel } from "@/components/patient-messages/CareTemplatesPanel";
import type { Permission } from "@/lib/permissions";

// Supervisors' own place for the messages the team sends patients: WhatsApp
// templates for patient care (appointment reminders… sent even after the
// 24-hour window) and the saved replies agents insert with "/". Admins see it
// too. The section is in the URL (?tab=) so a reload stays put.
const TABS = [
  { key: "templates", label: "WhatsApp templates", group: "Messages", icon: MessagesSquare, perm: "template:write_utility", description: "Appointment reminders and other patient-care messages, approved by WhatsApp" },
  { key: "saved-replies", label: "Saved replies", group: "Messages", icon: MessageSquareText, perm: "saved_reply:write", description: "Ready-made answers agents insert by typing /" },
] as const satisfies readonly { key: string; label: string; group: string; icon: LucideIcon; perm: Permission; description: string }[];

type TabKey = (typeof TABS)[number]["key"];

function PatientMessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, can } = useCurrentUser();
  const tabs = TABS.filter((t) => can(t.perm));

  if (!ready) return <PageSpinner />;
  if (tabs.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-[15px] font-semibold text-gray-800">No access</p>
        <p className="text-[13px] text-gray-500 mt-1">Patient messages are kept by supervisors and admins.</p>
      </div>
    );
  }

  const raw = searchParams.get("tab");
  const current = tabs.find((t) => t.key === raw) ?? tabs[0];

  return (
    <SectionedLayout
      title="Patient messages"
      subtitle="Templates and saved replies for the team"
      sections={tabs}
      active={current}
      onSelect={(key: TabKey) => router.replace(`/patient-messages?tab=${key}`, { scroll: false })}
      columnClassName="max-w-5xl"
    >
      {current.key === "templates" && <CareTemplatesPanel key="templates" />}
      {current.key === "saved-replies" && <SavedRepliesPanel key="saved-replies" />}
    </SectionedLayout>
  );
}

export default function PatientMessagesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PatientMessagesContent />
    </Suspense>
  );
}
