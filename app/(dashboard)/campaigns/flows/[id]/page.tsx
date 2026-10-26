"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrowLeft, History, Save } from "lucide-react";
import { ApiError, apiCreateFlow, apiDuplicateFlow, apiGetAssignableUsers, apiGetFlow, apiGetTemplates, apiUpdateFlow } from "@/lib/api";
import type { AssignableUser, Flow, FlowGraph, FlowValidationError, Template } from "@/types";
import { starterGraph } from "@/lib/flows";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { NoAccess } from "@/components/NoAccess";
import { PageSpinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { FlowBuilder, type FlowBuilderControl } from "@/components/flows/FlowBuilder";
import { FlowResponses } from "@/components/flows/FlowResponses";

type Tab = "builder" | "responses";

// A flow attached to a campaign at one of these stages is part of what was
// reviewed (or is already answering patients): the server refuses changes
// from anyone but an admin (FLOW_IN_USE).
const LOCKING_STATUSES = ["PENDING_APPROVAL", "SCHEDULED", "RUNNING", "PAUSED"];
const STATUS_WORDS: Record<string, string> = {
  PENDING_APPROVAL: "awaiting approval", SCHEDULED: "scheduled", RUNNING: "running", PAUSED: "paused",
};

// Unsaved work is kept in this browser while you edit, so a crash, a closed
// tab or a dead battery doesn't lose hours of building. It never saves to the
// server on its own: a flow attached to a running campaign answers patients
// the moment it's saved, so going live stays a deliberate click.
type Draft = { graph: FlowGraph; name: string; description: string; at: number; baseUpdatedAt?: string };
const draftKey = (flowId: number | null) => `everlast:flow-draft:${flowId ?? "new"}`;
const readDraft = (key: string): Draft | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};
const writeDraft = (key: string, d: Draft) => {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    // Storage full or blocked (private window): the leave prompt still protects the work.
  }
};
const clearDraft = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
};

const timeAgo = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
};
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const isNew = rawId === "new";
  const flowId = isNew ? null : Number(rawId);
  const key = draftKey(flowId);

  const router = useRouter();
  const { ready, can } = useCurrentUser();
  const canRead = can("campaign:read");
  const isAdmin = can("campaign:send");
  const { success, error } = useToast();

  const [flow, setFlow] = useState<Flow | null>(null);
  const [graph, setGraph] = useState<FlowGraph | null>(isNew ? starterGraph() : null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [agents, setAgents] = useState<AssignableUser[]>([]);
  const [tab, setTab] = useState<Tab>("builder");
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<FlowValidationError[]>([]);
  const [dirty, setDirtyState] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  // The server's FLOW_NAME_TAKEN answer, shown right under the name input.
  const [nameTaken, setNameTaken] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const builder = useRef<FlowBuilderControl | null>(null);
  // Remounts the builder when a backup is restored (it reads initialGraph once).
  const [builderKey, setBuilderKey] = useState(0);
  const [restorable, setRestorable] = useState<Draft | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [dirtySince, setDirtySince] = useState<number | null>(null);
  // Dirtiness and since-when change together ("Unsaved for 12 min").
  const setDirty = useCallback((v: boolean) => {
    setDirtyState(v);
    setDirtySince((since) => (v ? since ?? Date.now() : null));
  }, []);
  const [now, setNow] = useState(() => Date.now());
  // Where the person was heading when asked about unsaved changes.
  const [leaving, setLeaving] = useState<null | { href: string } | { back: true }>(null);

  const lockedBy = flow?.campaigns?.find((c) => LOCKING_STATUSES.includes(c.status)) ?? null;
  // Admins may still edit a locked flow (they approve anyway; it's audited).
  const canWrite = can("campaign:write") && (!lockedBy || isAdmin);
  // Read-only roles (supervisors) see how customers went through the flow,
  // not the builder.
  const responsesOnly = !can("campaign:write");
  const view: Tab = responsesOnly ? "responses" : tab;

  useEffect(() => {
    if (!ready || !canRead) return;
    let cancelled = false;
    // Templates feed the Start step's "copy buttons" picker; agents feed Assign.
    // Pending (SUBMITTED) templates are included on purpose: a flow can be
    // built while Meta reviews its template. Nothing can trigger it early —
    // the campaign that sends the template still needs it APPROVED.
    Promise.all([
      apiGetTemplates({ status: "APPROVED", category: "CAMPAIGN" }),
      apiGetTemplates({ status: "SUBMITTED", category: "CAMPAIGN" }),
    ])
      // Not-yet-set-up imported templates (needsSetup) can't be sent by a flow.
      .then(([approved, pending]) => { if (!cancelled) setTemplates([...approved.data, ...pending.data].filter((t) => !t.needsSetup?.length)); })
      .catch(() => {});
    apiGetAssignableUsers()
      .then((res) => { if (!cancelled) setAgents(res.data); })
      .catch(() => {});
    if (flowId) {
      apiGetFlow(flowId)
        .then((res) => {
          if (cancelled) return;
          setFlow(res.data);
          setGraph(res.data.graph);
          setName(res.data.name);
          setDescription(res.data.description || "");
          setRestorable(readDraft(draftKey(flowId)));
        })
        .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load the flow"); });
    }
    return () => { cancelled = true; };
  }, [ready, canRead, flowId]);

  // A backup left by an earlier visit (crash, closed tab) is offered once the
  // saved version has loaded (see the load above); a new flow checks on mount.
  useEffect(() => {
    if (!isNew) return;
    const t = setTimeout(() => setRestorable(readDraft(key)), 0);
    return () => clearTimeout(t);
  }, [isNew, key]);

  // Keep the backup current while there are unsaved changes.
  const latestGraph = useRef<FlowGraph | null>(null);
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleBackup = useCallback(() => {
    if (backupTimer.current) clearTimeout(backupTimer.current);
    backupTimer.current = setTimeout(() => {
      const g = latestGraph.current ?? builder.current?.snapshot();
      if (!g) return;
      writeDraft(key, { graph: g, name, description, at: Date.now(), baseUpdatedAt: flow?.updatedAt });
    }, 1500);
  }, [key, name, description, flow?.updatedAt]);
  const onGraphChange = useCallback((g: FlowGraph) => {
    latestGraph.current = g;
    scheduleBackup();
  }, [scheduleBackup]);
  useEffect(() => {
    if (dirty) scheduleBackup();
  }, [dirty, name, description, scheduleBackup]);

  // Re-renders the "Saved 3 min ago" / "Unsaved for 12 min" label.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // Closing or reloading the tab with unsaved edits: the browser asks.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Leaving inside the app (sidebar, "← Flows", any link): ask first.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving({ href: url.pathname + url.search + url.hash });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // The browser's Back button: a guard entry in history catches it.
  useEffect(() => {
    if (!dirty) return;
    window.history.pushState({ flowGuard: true }, "", window.location.href);
    const onPop = () => {
      window.history.pushState({ flowGuard: true }, "", window.location.href);
      setLeaving({ back: true });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dirty]);

  const baseUpdatedAt = flow?.updatedAt;
  const save = useCallback(async (g: FlowGraph): Promise<boolean> => {
    if (!name.trim()) {
      error("Give the flow a name first");
      return false;
    }
    setSaving(true);
    try {
      if (flowId) {
        // baseUpdatedAt: the server refuses this save if the flow changed
        // elsewhere since this tab loaded it, instead of overwriting it.
        const res = await apiUpdateFlow(flowId, { name, description, graph: g, baseUpdatedAt });
        setFlow((f) => (f ? { ...f, ...res.data } : f));
        setServerErrors([]);
        setNameTaken(null);
        setDirty(false);
        clearDraft(key);
        setLastSavedAt(Date.now());
        success("Flow saved");
        return true;
      }
      const res = await apiCreateFlow({ name, description, graph: g, isActive: true });
      setServerErrors([]);
      setDirty(false);
      clearDraft(key);
      success("Flow created");
      router.replace(`/campaigns/flows/${res.data.id}`);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "FLOW_NAME_TAKEN") {
        setNameTaken(err.message);
        error(err.message);
        nameRef.current?.focus();
        return false;
      }
      if (err instanceof ApiError && err.code === "FLOW_CHANGED") {
        setServerErrors([{ message: err.message }]);
        error(err.message);
        return false;
      }
      const list = err instanceof ApiError && Array.isArray(err.details?.errors) ? (err.details.errors as FlowValidationError[]) : [];
      setServerErrors(list.length ? list : [{ message: err instanceof Error ? err.message : "Couldn't save" }]);
      error(list.length ? `The flow has ${list.length} problem${list.length > 1 ? "s" : ""} — they're marked on the steps` : err instanceof Error ? err.message : "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  }, [flowId, baseUpdatedAt, name, description, router, success, error, key, setDirty]);

  const saveNow = useCallback(async () => {
    if (!canWrite || saving || !builder.current) return false;
    return builder.current.save();
  }, [canWrite, saving]);

  // Ctrl+S / ⌘S saves (instead of the browser's "Save page").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canWrite) void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWrite, saveNow]);

  const go = (target: NonNullable<typeof leaving>) => {
    setLeaving(null);
    setDirty(false);
    if ("href" in target) {
      router.push(target.href);
    } else {
      // Past the guard entry and the page itself.
      setTimeout(() => window.history.go(-2), 0);
    }
  };
  const leaveWithoutSaving = () => {
    if (!leaving) return;
    clearDraft(key);
    go(leaving);
  };
  const saveAndLeave = async () => {
    if (!leaving) return;
    const target = leaving;
    if (await saveNow()) go(target);
    else setLeaving(null); // the error is on screen; stay and fix it
  };

  const restoreBackup = () => {
    if (!restorable) return;
    setGraph(restorable.graph);
    setName(restorable.name);
    setNameTaken(null);
    setDescription(restorable.description);
    setBuilderKey((k) => k + 1);
    setRestorable(null);
    setDirty(true);
  };
  const discardBackup = () => {
    clearDraft(key);
    setRestorable(null);
  };

  // The switch moves at once and the server catches up (the round trip can
  // take a couple of seconds); if the server refuses, it moves back.
  const [toggling, setToggling] = useState(false);
  const toggleActive = async () => {
    if (!flow || toggling) return;
    const next = !flow.isActive;
    setToggling(true);
    setFlow((f) => (f ? { ...f, isActive: next } : f));
    try {
      const res = await apiUpdateFlow(flow.id, { isActive: next });
      // Keep the new updatedAt too, or the next save would look outdated.
      setFlow((f) => (f ? { ...f, isActive: res.data.isActive, updatedAt: res.data.updatedAt } : f));
      success(next ? "Flow is on — it answers campaign taps" : "Flow is off — campaign taps won't trigger it");
    } catch (err) {
      setFlow((f) => (f ? { ...f, isActive: !next } : f));
      error(err instanceof Error ? err.message : "Couldn't update the flow");
    } finally {
      setToggling(false);
    }
  };

  // "Duplicate it to make changes": a new flow with this one's saved steps.
  // The server picks a free "X (copy)" / "X (copy 2)" name.
  const duplicate = async () => {
    if (!flow) return;
    setDuplicating(true);
    try {
      const res = await apiDuplicateFlow(flow.id);
      success("Copy created — you can edit it");
      router.push(`/campaigns/flows/${res.data.id}`);
    } catch (err) {
      error(err instanceof Error ? err.message : "Couldn't duplicate the flow");
    } finally {
      setDuplicating(false);
    }
  };

  if (!ready) return <PageSpinner />;
  if (!canRead || (isNew && responsesOnly)) return <NoAccess what="flows" />;
  if (loadError) {
    return (
      <div className="p-8">
        <Link href="/campaigns/flows" className="text-[13px] text-gray-500 hover:text-gray-800">← Flows</Link>
        <p className="mt-6 text-[14px] text-red-600">{loadError}</p>
      </div>
    );
  }
  if (!graph) return <PageSpinner />;

  const unsavedLong = dirtySince != null && now - dirtySince > 10 * 60 * 1000;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <header className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100">
        <Link href="/campaigns/flows" className="inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" /> Flows
        </Link>
        <div className="flex flex-col min-w-[240px] flex-1">
          <input
            ref={nameRef}
            value={name}
            disabled={!canWrite}
            onChange={(e) => { setName(e.target.value); setNameTaken(null); setDirty(true); }}
            placeholder="Flow name, e.g. Laser offer — October"
            aria-invalid={Boolean(nameTaken)}
            className={`text-[16px] font-bold text-gray-900 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder:text-gray-300 ${nameTaken ? "underline decoration-red-400 decoration-2 underline-offset-4" : ""}`}
          />
          {nameTaken && <p className="text-[12px] text-red-500 font-medium">{nameTaken}</p>}
          <input
            value={description}
            disabled={!canWrite}
            onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
            placeholder="Description (optional)"
            className="text-[12px] text-gray-500 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder:text-gray-300"
          />
        </div>

        {flow && (
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            {flow.campaigns && flow.campaigns.length > 0 && (
              <span title={flow.campaigns.map((c) => c.name).join(", ")}>
                Used by {flow.campaigns.length} campaign{flow.campaigns.length > 1 ? "s" : ""}
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={flow.isActive}
              aria-busy={toggling}
              disabled={!canWrite}
              onClick={toggleActive}
              title={flow.isActive ? "On — click to turn the flow off" : "Off — click to turn the flow on"}
              className={`inline-flex items-center gap-2 rounded-full border pl-1.5 pr-3 py-1 font-semibold transition-colors disabled:opacity-50 ${toggling ? "cursor-progress" : ""} ${flow.isActive ? "border-brand/30 bg-brand-100 text-brand-fg" : "border-gray-200 bg-gray-50 text-gray-500"}`}
            >
              <span className={`relative w-8 h-[18px] rounded-full transition-colors duration-150 ${flow.isActive ? "bg-brand" : "bg-gray-300"}`}>
                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-[left] duration-150 ${flow.isActive ? "left-[16px]" : "left-[2px]"}`} />
              </span>
              {flow.isActive ? "On" : "Off"}
            </button>
          </div>
        )}

        {!responsesOnly && (
          <div className="inline-flex bg-gray-50 border border-gray-100 rounded-lg p-1 gap-1">
            {(["builder", "responses"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={t === "responses" && !flow}
                onClick={() => setTab(t)}
                className={`text-[13px] font-semibold rounded-md px-3.5 py-1.5 transition-colors disabled:opacity-40 ${tab === t ? "bg-brand text-white" : "text-gray-500 hover:text-gray-800"}`}
              >
                {t === "builder" ? "Builder" : `Responses${flow ? ` (${flow.runs.total})` : ""}`}
              </button>
            ))}
          </div>
        )}

        {canWrite && (
          <div className="flex items-center gap-2.5">
            <span
              className={`text-[12px] whitespace-nowrap ${dirty ? (unsavedLong ? "text-amber-700 font-semibold" : "text-amber-600") : "text-gray-400"}`}
              title="Ctrl+S (⌘S on a Mac) saves"
            >
              {dirty
                ? unsavedLong && dirtySince
                  ? `Unsaved for ${timeAgo(dirtySince, now).replace(" ago", "")}`
                  : "Unsaved changes"
                : lastSavedAt
                  ? `Saved ${timeAgo(lastSavedAt, now)}`
                  : flow
                    ? "All changes saved"
                    : ""}
            </span>
            <button
              type="button"
              onClick={() => void saveNow()}
              disabled={saving || (!dirty && !!flow)}
              title="Save (Ctrl+S)"
              className="inline-flex items-center gap-1.5 bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg px-3.5 py-1.5"
            >
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </header>

      {restorable && canWrite && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-sky-200 bg-sky-50 text-[13px] text-sky-900">
          <History className="w-4 h-4 shrink-0" />
          <p className="flex-1 min-w-[240px]">
            You have unsaved work on this flow from <b>{clock(restorable.at)}</b>
            {flow?.updatedAt && restorable.baseUpdatedAt && restorable.baseUpdatedAt !== flow.updatedAt
              ? " — the flow was saved by someone since; restoring and saving would replace their version."
              : "."}
          </p>
          <button type="button" onClick={restoreBackup} className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-800">
            Restore it
          </button>
          <button type="button" onClick={discardBackup} className="shrink-0 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-sky-800 hover:bg-sky-100">
            Discard
          </button>
        </div>
      )}

      {lockedBy && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-amber-200 bg-amber-50 text-[13px] text-amber-800">
          <p className="flex-1 min-w-[240px]">
            {isAdmin
              ? <>Used by campaign <b>{lockedBy.name}</b> ({STATUS_WORDS[lockedBy.status]}). Changes apply to it straight away and are recorded in the audit log.</>
              : <>Locked: used by campaign <b>{lockedBy.name}</b> ({STATUS_WORDS[lockedBy.status]}). Duplicate it to make changes.</>}
          </p>
          {can("campaign:write") && (
            <button
              type="button"
              onClick={duplicate}
              disabled={duplicating}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {duplicating ? "Duplicating…" : "Duplicate"}
            </button>
          )}
        </div>
      )}

      {/* The builder stays mounted while Responses is open, so switching tabs
          never throws away unsaved edits on the canvas. */}
      {!responsesOnly && (
      <div className={`flex-1 min-h-0 ${view === "builder" || !flow ? "flex" : "hidden"}`}>
        <ReactFlowProvider>
          <FlowBuilder
            key={builderKey}
            initialGraph={graph}
            templates={templates}
            agents={agents}
            readOnly={!canWrite}
            saving={saving}
            serverErrors={serverErrors}
            onSave={save}
            onDirtyChange={setDirty}
            controlRef={builder}
            onGraphChange={onGraphChange}
          />
        </ReactFlowProvider>
      </div>
      )}
      {view === "responses" && flow &&<FlowResponses flowId={flow.id} flowName={flow.name} graph={flow.graph} />}

      {leaving && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="w-full max-w-[420px] rounded-2xl bg-white border border-gray-100 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h2 id="leave-title" className="text-[16px] font-bold text-gray-900">You have unsaved changes</h2>
              <p className="text-[13px] text-gray-500 leading-relaxed">
                If you leave now, the changes you made to this flow will be lost.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void saveAndLeave()}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-brand hover:bg-[#2f5840] disabled:opacity-60 text-white text-[13px] font-semibold rounded-xl py-2.5"
              >
                <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save and leave"}
              </button>
              <button
                type="button"
                onClick={leaveWithoutSaving}
                className="w-full rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-[13px] font-semibold py-2.5"
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={() => setLeaving(null)}
                autoFocus
                className="w-full rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-[13px] font-semibold py-2.5"
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
