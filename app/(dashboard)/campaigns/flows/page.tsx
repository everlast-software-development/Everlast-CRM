"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ClipboardCopy, CopyPlus, Download, Plus, Trash2, Upload, Workflow } from "lucide-react";
import { ApiError, apiCreateFlow, apiDeleteFlow, apiDuplicateFlow, apiGetFlow, apiGetFlows, apiGetTemplates, apiUpdateFlow } from "@/lib/api";
import { FlowFileError, downloadFlowFile, flowFileText, openImportedDraft, parseFlowFile, readFlowFile, relinkTemplates } from "@/lib/flowTransfer";
import { validateFlow } from "@/lib/flows";
import type { FlowSummary } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { NoAccess } from "@/components/NoAccess";
import { PageSpinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

export default function FlowsPage() {
  const router = useRouter();
  const { ready, can } = useCurrentUser();
  const canRead = can("campaign:read");
  const canWrite = can("campaign:write");
  const { success, error } = useToast();
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [deleting, setDeleting] = useState<FlowSummary | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

  // A whole flow, copied: a new flow with the same steps, then opened. The
  // server picks a free "X (copy)" / "X (copy 2)" name (flow names are unique).
  const duplicate = async (f: FlowSummary) => {
    setDuplicatingId(f.id);
    try {
      const res = await apiDuplicateFlow(f.id);
      success("Copy created — you can edit it");
      router.push(`/campaigns/flows/${res.data.id}`);
    } catch (err) {
      error(err instanceof Error ? err.message : "Couldn't duplicate the flow");
    } finally {
      setDuplicatingId(null);
    }
  };

  // ── Export / import (.flow.json) ──
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const exportFlow = async (f: FlowSummary) => {
    setExportingId(f.id);
    try {
      // Templates give the file each referenced template's name (ids differ per environment).
      const [flow, templates] = await Promise.all([apiGetFlow(f.id), apiGetTemplates().catch(() => ({ data: [] }))]);
      downloadFlowFile(flow.data, templates.data);
    } catch (err) {
      error(err instanceof Error ? err.message : "Couldn't export the flow");
    } finally {
      setExportingId(null);
    }
  };

  // Created straight away, turned off, under a free name. A flow that doesn't
  // pass the checks here (a template that doesn't exist in this account, say)
  // opens in the builder unsaved instead, to be fixed and saved.
  const importFile = async (file: File | undefined) => {
    if (file) await importText(await file.text());
  };

  // Copy flow puts the flow on the clipboard. Pasted into another flow's
  // canvas it lands beside the steps there; pasted here (Ctrl+V) it becomes a
  // new flow, the same as importing the file.
  const copyFlow = async (f: FlowSummary) => {
    setExportingId(f.id);
    try {
      const [flow, templates] = await Promise.all([apiGetFlow(f.id), apiGetTemplates().catch(() => ({ data: [] }))]);
      await navigator.clipboard.writeText(flowFileText(flow.data, templates.data));
      success("Flow copied — paste it into another flow (Ctrl+V) to add its steps, or here to make a new flow");
    } catch (err) {
      error(err instanceof Error ? err.message : "Couldn't copy the flow");
    } finally {
      setExportingId(null);
    }
  };

  const importText = async (text: string) => {
    setImporting(true);
    try {
      const parsed = parseFlowFile(text);
      const templates = await apiGetTemplates().catch(() => ({ data: [] }));
      const { graph, missing } = relinkTemplates(parsed.graph, templates.data);
      const note = missing.length ? ` Pick the template again for: ${missing.join(", ")}.` : "";

      const problems = validateFlow(graph);
      if (!problems.length) {
        for (let n = 0; n < 10; n++) {
          const name = n === 0 ? parsed.name : `${parsed.name} (imported${n > 1 ? ` ${n}` : ""})`;
          try {
            const res = await apiCreateFlow({ name, description: parsed.description, graph, isActive: false });
            success(`Imported as “${name}” — it's off until you turn it on.${note}`);
            router.push(`/campaigns/flows/${res.data.id}`);
            return;
          } catch (err) {
            if (err instanceof ApiError && err.code === "FLOW_NAME_TAKEN") continue;
            if (err instanceof ApiError && Array.isArray(err.details?.errors)) break; // open it to fix instead
            throw err;
          }
        }
      }
      openImportedDraft(parsed.name, parsed.description, graph);
      error(`Imported, not saved yet — fix the problems marked on the steps, then save.${note}`);
      router.push("/campaigns/flows/new?import=1");
    } catch (err) {
      error(err instanceof FlowFileError || err instanceof Error ? err.message : "Couldn't import that file");
    } finally {
      setImporting(false);
    }
  };

  const importTextRef = useRef(importText);
  useEffect(() => {
    importTextRef.current = importText;
  });
  useEffect(() => {
    if (!canWrite) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!readFlowFile(text)) return; // not a flow: leave the paste alone
      e.preventDefault();
      void importTextRef.current(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canWrite]);

  useEffect(() => {
    if (!ready || !canRead) return;
    let cancelled = false;
    apiGetFlows()
      .then((res) => { if (!cancelled) setFlows(res.data); })
      .catch((err) => { if (!cancelled) { error(err instanceof Error ? err.message : "Couldn't load flows"); setFlows([]); } });
    return () => { cancelled = true; };
  }, [ready, canRead, error]);

  // The switch moves at once; the server catches up and, if it refuses, the
  // switch moves back.
  const setActive = (id: number, isActive: boolean) =>
    setFlows((list) => list?.map((x) => (x.id === id ? { ...x, isActive } : x)) ?? list);
  const toggle = async (f: FlowSummary) => {
    const next = !f.isActive;
    setActive(f.id, next);
    try {
      await apiUpdateFlow(f.id, { isActive: next });
    } catch (err) {
      setActive(f.id, !next);
      error(err instanceof Error ? err.message : "Couldn't update the flow");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await apiDeleteFlow(deleting.id);
      setFlows((list) => list?.filter((x) => x.id !== deleting.id) ?? list);
      success("Flow deleted");
    } catch (err) {
      error(err instanceof Error ? err.message : "Couldn't delete the flow");
    } finally {
      setDeleting(null);
    }
  };

  if (!ready) return <PageSpinner />;
  if (!canRead) return <NoAccess what="flows" />;

  return (
    <div className="p-6 lg:p-8 bg-canvas min-h-full overflow-y-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Flows</h1>
          <p className="text-sm text-gray-400 mt-0.5 max-w-2xl">
            Automations that answer a campaign&apos;s buttons: send the next message, show options, ask questions, tag the customer and hand them to an agent.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-xl disabled:opacity-60"
              title="Create a flow from a .flow.json file exported here or in another environment"
            >
              <Upload className="w-4 h-4" /> {importing ? "Importing…" : "Import flow"}
            </button>
            <button
              onClick={() => router.push("/campaigns/flows/new")}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-4 py-2 rounded-xl"
            >
              <Plus className="w-4 h-4" /> New flow
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }}
            />
          </div>
        )}
      </div>

      {flows === null ? (
        <div className="mt-6 h-40 bg-white rounded-xl border border-gray-100 animate-pulse" />
      ) : flows.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 py-16 flex flex-col items-center text-center gap-2">
          <Workflow className="w-10 h-10 text-gray-300" />
          <p className="text-[15px] font-semibold text-gray-700">No flows yet</p>
          <p className="text-[13px] text-gray-400 max-w-md">
            Build one, then pick it when creating a campaign. When a customer taps a button on the campaign message, the flow takes it from there.
          </p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="px-5 py-3 font-semibold">Flow</th>
                <th className="px-5 py-3 font-semibold">Active</th>
                <th className="px-5 py-3 font-semibold text-right">Campaigns</th>
                <th className="px-5 py-3 font-semibold text-right">Responses</th>
                <th className="px-5 py-3 font-semibold text-right">Completed</th>
                <th className="px-5 py-3 font-semibold text-right">To agent</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {flows.map((f) => (
                <tr key={f.id} className="hover:bg-brand-50 cursor-pointer" onClick={() => router.push(`/campaigns/flows/${f.id}`)}>
                  <td className="px-5 py-3">
                    <p className="font-semibold text-gray-900">{f.name}</p>
                    {f.description && <p className="text-[12px] text-gray-400 truncate max-w-md">{f.description}</p>}
                  </td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => toggle(f)}
                      className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${f.isActive ? "bg-brand" : "bg-gray-200"}`}
                      title={f.isActive ? "On: answers campaign taps" : "Off: taps are left for agents"}
                    >
                      <span className={`absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${f.isActive ? "left-[19px]" : "left-[3px]"}`} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700">{f.campaignCount}</td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-800">{f.runs.total}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{f.runs.COMPLETED ?? 0}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{f.runs.HANDED_OFF ?? 0}</td>
                  <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{new Date(f.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void copyFlow(f)}
                      disabled={exportingId !== null}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-fg hover:bg-brand-100 disabled:opacity-40"
                      title="Copy flow — paste it into another flow, or here to make a copy"
                    >
                      <ClipboardCopy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportFlow(f)}
                      disabled={exportingId !== null}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-fg hover:bg-brand-100 disabled:opacity-40"
                      title="Export this flow (.flow.json)"
                    >
                      <Download className={`w-4 h-4 ${exportingId === f.id ? "animate-pulse" : ""}`} />
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => void duplicate(f)}
                        disabled={duplicatingId !== null}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-brand-fg hover:bg-brand-100 disabled:opacity-40"
                        title="Duplicate this flow"
                      >
                        <CopyPlus className={`w-4 h-4 ${duplicatingId === f.id ? "animate-pulse" : ""}`} />
                      </button>
                    )}
                    {canWrite && f.runs.total === 0 && (
                      <button type="button" onClick={() => setDeleting(f)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center" onClick={() => setDeleting(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-gray-900">Delete “{deleting.name}”?</h3>
            <p className="text-[13px] text-gray-500 mt-2">It hasn&apos;t been used yet, so nothing is lost. Campaigns using it will stop running automation.</p>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setDeleting(null)} className="text-[13px] font-medium text-gray-600 border border-gray-200 rounded-xl px-4 py-2">Cancel</button>
              <button type="button" onClick={confirmDelete} className="text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl px-4 py-2">Delete</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
