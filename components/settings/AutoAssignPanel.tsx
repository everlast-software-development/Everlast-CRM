"use client";

import { useCallback, useEffect, useState } from "react";
import { Shuffle } from "lucide-react";
import { apiGetSettings, apiSaveAutoAssign } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { LoadError, SectionCard, Toggle, errorMessage } from "@/components/settings/shared";

// Who gets a new chat. On: the app gives it to one online agent straight away
// (the API's utils/autoAssign.js), so agents don't race for patients. Off: the
// first person to reply takes it. Saved the moment it's switched.
export function AutoAssignPanel() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return apiGetSettings()
      .then((res) => {
        setEnabled(res.data.autoAssign?.enabled !== false);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load the setting.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function change(next: boolean) {
    const before = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const res = await apiSaveAutoAssign({ enabled: next });
      setEnabled(res.data.enabled);
      toast.success(next ? "New chats are given out automatically" : "The first person to reply takes a chat");
    } catch (err) {
      setEnabled(before);
      toast.error(errorMessage(err, "Couldn't save the setting."));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <div className="px-6 py-6"><LoadError message={loadError} onRetry={load} /></div>;
  if (enabled === null) return <PageSpinner label="Loading" />;

  return (
    <div className="px-6 py-6 max-w-2xl">
      <SectionCard
        title="Assigning chats"
        description="Who answers a patient nobody is talking to yet."
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-gray-700">Give new chats out automatically</p>
              <p className="text-[12px] text-gray-400 mt-0.5">
                {enabled
                  ? "On: each new chat goes to one agent, so two people never answer the same patient."
                  : "Off: the first person to reply takes the chat."}
              </p>
            </div>
            <Toggle checked={enabled} onChange={change} disabled={saving} label="Give new chats out automatically" />
          </div>

          <div className={`flex items-start gap-3 bg-brand-100 rounded-xl px-4 py-3 ${enabled ? "" : "opacity-60"}`}>
            <Shuffle className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" />
            <ul className="text-[12px] text-gray-600 space-y-1">
              <li>
                When a patient writes and nobody owns the chat, it goes to the <b>online agent with the fewest open chats</b>. When
                agents are level, they take turns.
              </li>
              <li>The agent gets an alert with a chime. Only agents are given chats; supervisors and admins aren&apos;t.</li>
              <li>While a flow is talking to the patient, the chat waits. When the flow hands them over, it goes to one agent.</li>
              <li>
                With nobody online (overnight, for example), chats wait in Unassigned. When agents come online they&apos;re shared
                out, one per agent each minute, oldest first.
              </li>
              <li>A chat someone gives back goes to another agent, not straight back to them. Supervisors can still move any chat.</li>
            </ul>
          </div>

          <p className="text-[12px] text-gray-400">
            Either way, two people can&apos;t both send to an unowned chat by accident: whoever sends first takes it, and the other is
            asked before their message goes out.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
