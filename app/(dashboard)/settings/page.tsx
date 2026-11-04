"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquareText, MoonStar, ShieldCheck, Smartphone, UserRound, Users, type LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";
import { SectionedLayout } from "@/components/SectionedLayout";
import { UsersPanel } from "@/components/settings/UsersPanel";
import { WhatsAppNumbersPanel } from "@/components/settings/WhatsAppNumbersPanel";
import { QuietHoursPanel } from "@/components/settings/QuietHoursPanel";
import { CampaignSafetyPanel } from "@/components/settings/CampaignSafetyPanel";
import { MyAccountPanel } from "@/components/settings/MyAccountPanel";
import { SavedRepliesPanel } from "@/components/settings/SavedRepliesPanel";
import type { Permission } from "@/lib/permissions";

// The section lives in the URL (?tab=) so a link — or the old /team page — can
// open a specific one, and a reload stays where you were. `wide` sections hold
// tables; the rest are forms and get a narrower centred column. `perm` is what
// a tab needs (null: everyone who reaches Settings); supervisors reach Settings
// for My account alone — their saved replies are on Patient Messages.
const TABS = [
  { key: "users", label: "Users", group: "Workspace", icon: Users, wide: true, perm: "user:write", description: "Who can sign in, their roles and what they can access" },
  { key: "numbers", label: "WhatsApp numbers", group: "Workspace", icon: Smartphone, wide: true, perm: "number:write", description: "The WhatsApp lines the team sends and receives on" },
  { key: "quiet-hours", label: "Quiet hours", group: "Messaging", icon: MoonStar, wide: false, perm: "settings:write", description: "When campaign messages are held back" },
  { key: "campaign-safety", label: "Campaign safety", group: "Messaging", icon: ShieldCheck, wide: false, perm: "settings:write", description: "Limits that protect patients and the number's quality" },
  { key: "saved-replies", label: "Saved replies", group: "Messaging", icon: MessageSquareText, wide: true, perm: "settings:write", description: "Ready-made answers agents insert by typing /" },
  { key: "account", label: "My account", group: "Personal", icon: UserRound, wide: false, perm: null, description: "Your profile and password" },
] as const satisfies readonly { key: string; label: string; group: string; icon: LucideIcon; wide: boolean; perm: Permission | null; description: string }[];

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(v: string | null, tabs: readonly { key: string }[]): v is TabKey {
  return tabs.some((t) => t.key === v);
}

function PageHeader() {
  return (
    <div className="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
      <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">
        Settings
      </h1>
      <p className="text-[13px] text-gray-400 mt-0.5">
        Manage your workspace settings
      </p>
    </div>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useCurrentUser();
  const tabs = TABS.filter((t) => t.perm === null || can(t.perm));
  const raw = searchParams.get("tab");
  const tab: TabKey = isTabKey(raw, tabs) ? raw : tabs[0].key;
  const current = tabs.find((t) => t.key === tab)!;

  function selectTab(key: TabKey) {
    router.replace(`/settings?tab=${key}`, { scroll: false });
  }

  return (
    <SectionedLayout
      title="Settings"
      subtitle="Manage your workspace settings"
      sections={tabs}
      active={current}
      onSelect={selectTab}
      columnClassName={current.wide ? "max-w-5xl" : "max-w-2xl"}
    >
      {/* Active section — keyed so switching always starts it fresh */}
      {tab === "users" && <UsersPanel key="users" />}
      {tab === "numbers" && <WhatsAppNumbersPanel key="numbers" />}
      {tab === "quiet-hours" && <QuietHoursPanel key="quiet-hours" />}
      {tab === "campaign-safety" && <CampaignSafetyPanel key="campaign-safety" />}
      {tab === "saved-replies" && <SavedRepliesPanel key="saved-replies" />}
      {tab === "account" && <MyAccountPanel key="account" />}
    </SectionedLayout>
  );
}


export default function SettingsPage() {
  const router = useRouter();
  // Access comes from the server's permission list, never from the role
  // name: see CurrentUserProvider. `ready` is false until /users/me answers.
  const { ready, can } = useCurrentUser();
  const allowed = can("settings:write") || can("saved_reply:write");

  if (!ready) return <PageSpinner />;
  if (!allowed) {
    return (
      <div className="min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
        <PageHeader />

        {/* Access denied card */}
        <div className="max-w-md mx-auto mt-16 bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          {/* Lock icon */}
          <svg
            className="w-12 h-12 text-gray-300 mx-auto mb-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>

          <h2 className="text-[17px] font-bold text-gray-700 mb-2">
            Access Restricted
          </h2>
          <p className="text-[13px] text-gray-400">
            You need admin privileges to view this page.
          </p>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-6 inline-flex items-center gap-2 bg-brand hover:bg-[#2f5840] active:bg-[#264a33] text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl transition-colors cursor-pointer"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<PageSpinner />}>
      <SettingsContent />
    </Suspense>
  );
}
