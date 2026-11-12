"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiGetSettings, apiGetStoreSettings, apiSaveAiAssistant } from "@/lib/api";
import type { AiAssistantSetting, StoreConnection } from "@/types";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { LoadError, SectionCard, Toggle, errorMessage } from "@/components/settings/shared";

// One editable rule: a number with its unit, saved when it changes and leaves the field.
function RuleInput({ label, unit, value, min, max, hint, onSave }: {
  label: string; unit: string; value: number; min: number; max: number; hint: string; onSave: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
  const commit = () => { if (valid && n !== value) onSave(n); else if (!valid) setDraft(String(value)); };
  return (
    <div>
      <label className="text-[12px] font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          className={`w-20 rounded-lg border px-2.5 py-1.5 text-[13px] outline-none ${valid ? "border-gray-200 focus:border-brand" : "border-red-300"}`}
        />
        <span className="text-[12px] text-gray-500">{unit}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">{hint} ({min}–{max})</p>
    </div>
  );
}

// The store's AI answering chats nobody owns (the API's utils/aiAssistant.js).
// The store runs the AI; the CRM decides when it may answer and hands over to
// the team. Saved the moment something changes.
export function AiAssistantPanel() {
  const toast = useToast();
  const { numbers } = useActiveNumber();
  const [ai, setAi] = useState<AiAssistantSetting | null>(null);
  const [storeConn, setStoreConn] = useState<StoreConnection | null>(null);
  const [testPhones, setTestPhones] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      apiGetSettings().then((r) => {
        setAi(r.data.aiAssistant ?? { enabled: false, mode: "test", numberIds: [] });
        setTestPhones(r.data.testPhones?.phones ?? []);
      }),
      apiGetStoreSettings().then((r) => setStoreConn(r.data)).catch(() => setStoreConn(null)),
    ])
      .then(() => setLoadError(null))
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load the setting.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<AiAssistantSetting>, ok: string) {
    if (!ai) return;
    const before = ai;
    setAi({ ...ai, ...patch });
    setSaving(true);
    try {
      const res = await apiSaveAiAssistant(patch);
      setAi(res.data);
      toast.success(ok);
    } catch (err) {
      setAi(before);
      toast.error(errorMessage(err, "Couldn't save."));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <div className="px-6 py-6"><LoadError message={loadError} onRetry={load} /></div>;
  if (!ai) return <PageSpinner label="Loading" />;

  const connected = Boolean(storeConn?.apiBase && storeConn?.apiKeyHint);
  const allLines = ai.numberIds.length === 0;
  const toggleLine = (id: number) => {
    const current = allLines ? numbers.map((n) => n.id) : ai.numberIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    save({ numberIds: next.length === numbers.length ? [] : next }, "Lines saved");
  };

  return (
    <div className="px-6 py-6 max-w-2xl">
      <SectionCard title="AI assistant" description="The store's AI answers WhatsApp chats nobody owns, and hands them to the team when a person is needed.">
        <div className="space-y-5">
          <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[12.5px] ${connected ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {connected ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>
              {connected ? (
                <>Connected to the store at <span className="font-mono">{storeConn!.apiBase}</span> (key {storeConn!.apiKeyHint}).</>
              ) : (
                <>Enter the store&apos;s API address and access key first, in <Link href="/templates?tab=website" className="underline font-semibold">Templates → Website</Link>. The key needs the store&apos;s <b>whatsapp_chat</b> permission.</>
              )}
            </span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-gray-700 flex items-center gap-2"><Bot className="w-4 h-4 text-gray-400" /> Let the AI answer</p>
              <p className="text-[12px] text-gray-400 mt-0.5">{ai.enabled ? "On." : "Off: new chats go straight to the team, as before."}</p>
            </div>
            <Toggle checked={ai.enabled} onChange={(v) => save({ enabled: v }, v ? "AI switched on" : "AI switched off")} disabled={saving || (!connected && !ai.enabled)} label="Let the AI answer" />
          </div>

          <div>
            <p className="text-[13px] font-semibold text-gray-700 mb-2">Who it answers</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ["test", "Staff test phones only", `For trying it safely: only ${testPhones.length ? testPhones.map((p) => `+${p}`).join(", ") : "the staff test numbers (none yet)"} get AI answers.`],
                ["all", "Every customer", "Every chat nobody owns, new and returning customers."],
              ] as const).map(([k, title, hint]) => (
                <label key={k} className={`flex items-start gap-2.5 border rounded-xl px-3 py-2.5 cursor-pointer ${ai.mode === k ? "border-brand bg-brand-50" : "border-gray-200"}`}>
                  <input type="radio" name="ai-mode" checked={ai.mode === k} onChange={() => save({ mode: k }, k === "all" ? "The AI now answers every customer" : "The AI now answers staff test phones only")} disabled={saving} className="mt-0.5 accent-brand" />
                  <span>
                    <span className="block text-[13px] font-semibold text-gray-800">{title}</span>
                    <span className="block text-[11.5px] text-gray-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {ai.mode === "test" && <p className="text-[11.5px] text-gray-400 mt-1.5">Staff test numbers are set in <Link href="/settings?tab=campaign-safety" className="underline">Campaign safety</Link>.</p>}
          </div>

          {numbers.length > 1 && (
            <div>
              <p className="text-[13px] font-semibold text-gray-700 mb-2">On these lines</p>
              <div className="space-y-1.5">
                {numbers.map((n) => (
                  <label key={n.id} className="flex items-center gap-2.5 text-[13px] text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={allLines || ai.numberIds.includes(n.id)} onChange={() => toggleLine(n.id)} disabled={saving} className="accent-brand" />
                    {n.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[13px] font-semibold text-gray-700 mb-2">Rules</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <RuleInput
                label="Quiet after a hand-over"
                unit="hours"
                value={ai.quietHours ?? 24}
                min={0}
                max={168}
                hint="0 = it may answer again as soon as nobody owns the chat."
                onSave={(v) => save({ quietHours: v }, "Quiet time saved")}
              />
              <RuleInput
                label="Wait after each message"
                unit="seconds"
                value={ai.gatherSeconds ?? 3}
                min={1}
                max={10}
                hint="Messages sent within this are answered together."
                onSave={(v) => save({ gatherSeconds: v }, "Wait saved")}
              />
              <RuleInput
                label="Longest wait"
                unit="seconds"
                value={ai.maxGatherSeconds ?? 10}
                min={ai.gatherSeconds ?? 1}
                max={30}
                hint="For someone who keeps writing."
                onSave={(v) => save({ maxGatherSeconds: v }, "Longest wait saved")}
              />
            </div>
          </div>

          <ul className="text-[12px] text-gray-600 space-y-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 list-disc pl-8">
            <li>It answers only chats <b>nobody owns</b>, after any flow. Automatic assignment waits while it&apos;s answering.</li>
            <li>The moment someone <b>takes the chat or replies</b>, it stops. An answer still on its way is thrown away.</li>
            <li>When the customer wants a person, or the store can&apos;t answer, the chat goes to an online agent with the reason. The AI then stays out of that chat for the quiet time above, and while a person owns it.</li>
            <li>Its messages show as <b>AI</b> in the chat, and the inbox shows &ldquo;AI answering&rdquo;. Staff can also read these chats in the store&apos;s Admin → Assistant chats.</li>
            <li>STOP / إيقاف: the AI stops, and the store&apos;s own WhatsApp messages stop too.</li>
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}
