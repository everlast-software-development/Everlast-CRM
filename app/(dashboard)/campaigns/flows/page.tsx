"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CopyPlus, Plus, Trash2, Workflow } from "lucide-react";
import { apiDeleteFlow, apiDuplicateFlow, apiGetFlows, apiUpdateFlow } from "@/lib/api";
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
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Campaigns
      </Link>
      <div className="flex items-start justify-between mt-3">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Flows</h1>
          <p className="text-sm text-gray-400 mt-0.5 max-w-2xl">
            Automations that answer a campaign&apos;s buttons: send the next message, show options, ask questions, tag the customer and hand them to an agent.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => router.push("/campaigns/flows/new")}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-4 py-2 rounded-xl"
          >
            <Plus className="w-4 h-4" /> New flow
          </button>
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
