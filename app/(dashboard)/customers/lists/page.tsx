"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Users, Trash2, Megaphone } from "lucide-react";
import { apiGetLists, apiCreateList, apiAddListMembers, apiDeleteList, ApiError } from "@/lib/api";
import ContactPicker from "@/components/ContactPicker";
import type { ContactList } from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function ContactListsPage() {
  // Viewing lists is list:read; creating, editing, importing into and deleting
  // them is list:write; starting a campaign from one needs campaign rights.
  const { can } = useCurrentUser();
  const canEdit = can("list:write");
  const canCampaign = can("campaign:write", "campaign:send");
  const router = useRouter();

  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<"info" | "method">("info");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdListId, setCreatedListId] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ContactList | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetLists();
      setLists(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetCreateFlow() {
    setShowCreate(false);
    setCreateStep("info");
    setName("");
    setDescription("");
    setCreateError(null);
    setCreatedListId(null);
    setShowPicker(false);
  }

  async function goToMethodStep() {
    if (!name.trim()) return;
    // The server refuses a duplicate name too (409); checking the loaded lists
    // here just says so before the user picks how to fill it.
    const wanted = name.trim().toLowerCase();
    if (lists.some((l) => l.name.trim().toLowerCase() === wanted)) {
      setCreateError("A list with this name already exists");
      return;
    }
    setCreateError(null);
    setCreateStep("method");
  }

  // A name clash (someone else just made one) sends the user back to the name.
  function createFailed(err: unknown) {
    setCreateError(err instanceof Error ? err.message : "Failed to create list");
    if (err instanceof ApiError && err.status === 409) setCreateStep("info");
  }

  async function chooseImportCSV() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiCreateList({ name: name.trim(), description: description.trim() || undefined });
      resetCreateFlow();
      router.push(`/customers/lists/${res.data.id}/import`);
    } catch (err) {
      createFailed(err);
    } finally {
      setCreating(false);
    }
  }

  async function chooseSelectFromContacts() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiCreateList({ name: name.trim(), description: description.trim() || undefined });
      setCreatedListId(res.data.id);
      setShowPicker(true);
    } catch (err) {
      createFailed(err);
    } finally {
      setCreating(false);
    }
  }

  async function handlePickerCancel() {
    // Don't leave an empty orphaned list behind if the user backs out.
    if (createdListId) {
      try { await apiDeleteList(createdListId); } catch { /* best effort */ }
    }
    resetCreateFlow();
  }

  async function handlePickerConfirm(ids: number[]) {
    if (!createdListId) return;
    try {
      await apiAddListMembers(createdListId, ids);
    } catch {
      // list still exists even if linking partially failed; land on detail page either way
    }
    const id = createdListId;
    resetCreateFlow();
    router.push(`/customers/lists/${id}`);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDeleteList(deleteTarget.id);
      setLists((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete list");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Lists</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">Group contacts into saved lists for targeted campaigns</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Full-width create button */}
        {canEdit && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full flex flex-col items-center justify-center gap-2 py-8 mb-6 rounded-2xl border-2 border-dashed border-gray-200 hover:border-brand hover:bg-brand-100 transition-colors cursor-pointer group"
        >
          <div className="w-11 h-11 rounded-2xl bg-brand-200 group-hover:bg-white flex items-center justify-center transition-colors">
            <svg className="w-5 h-5 text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </div>
          <p className="text-[14px] font-semibold text-gray-700 group-hover:text-brand-fg">Create List</p>
        </button>
        )}

        {error && <p className="text-[13px] text-red-500 text-center mb-4">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-10">
            <svg className="w-6 h-6 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          </div>
        ) : lists.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mx-auto mb-4">
              <ListChecks className="w-6 h-6 text-brand-fg" />
            </div>
            <h2 className="text-[16px] font-semibold text-gray-800">No lists yet</h2>
            <p className="text-[13.5px] text-gray-400 mt-1.5">Create your first list to group contacts for campaigns.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {lists.map((l) => (
              <div
                key={l.id}
                onClick={() => router.push(`/customers/lists/${l.id}`)}
                className="relative p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-sm bg-white transition-all cursor-pointer group"
              >
                {canEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(l); }}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="Delete list"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                )}
                <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center mb-3">
                  <ListChecks className="w-4 h-4 text-brand-fg" />
                </div>
                <p className="text-[14px] font-semibold text-gray-900 truncate pr-6">{l.name}</p>
                <p className="text-[12px] text-gray-400 mt-0.5 line-clamp-2 min-h-[32px]">{l.description || "No description"}</p>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500">
                    <Users className="w-3.5 h-3.5" />
                    {l.memberCount.toLocaleString()} contact{l.memberCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[11px] text-gray-300">{formatDate(l.createdAt)}</span>
                </div>
                {canCampaign && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); router.push(`/campaigns/new?listId=${l.id}`); }}
                  disabled={l.memberCount === 0}
                  title={l.memberCount === 0 ? "Add contacts to this list first" : undefined}
                  className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-brand-100 hover:border-brand hover:text-brand-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-600 transition-colors cursor-pointer"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  Create Campaign
                </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create list modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-6 w-[440px] max-w-full space-y-5">
            {createStep === "info" ? (
              <>
                <div>
                  <h3 className="text-[15px] font-bold text-gray-900">Create list</h3>
                  <p className="text-[12px] text-gray-400 mt-0.5">Give your list a name and, optionally, a description.</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[12px] font-semibold text-gray-600 mb-1 block">List name <span className="text-red-500">*</span></label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. VIP Patients"
                      autoFocus
                      className="w-full text-[13px] rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-gray-600 mb-1 block">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What is this list for?"
                      rows={3}
                      className="w-full text-[13px] rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors resize-none"
                    />
                  </div>
                </div>
                {createError && <p className="text-[12px] text-red-500">{createError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={resetCreateFlow} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={goToMethodStep}
                    disabled={!name.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer"
                  >
                    Next →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-[15px] font-bold text-gray-900">Add contacts to &quot;{name.trim()}&quot;</h3>
                  <p className="text-[12px] text-gray-400 mt-0.5">Choose how you&apos;d like to populate this list.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={chooseSelectFromContacts}
                    disabled={creating}
                    className="flex flex-col items-center gap-2.5 p-5 rounded-2xl border-2 border-gray-200 hover:border-brand hover:bg-brand-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Users className="w-6 h-6 text-brand-fg" />
                    <span className="text-[13px] font-semibold text-gray-800 text-center">Select from Contacts</span>
                  </button>
                  <button
                    type="button"
                    onClick={chooseImportCSV}
                    disabled={creating}
                    className="flex flex-col items-center gap-2.5 p-5 rounded-2xl border-2 border-gray-200 hover:border-brand hover:bg-brand-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <svg className="w-6 h-6 text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <span className="text-[13px] font-semibold text-gray-800 text-center">Import CSV</span>
                  </button>
                </div>
                {createError && <p className="text-[12px] text-red-500">{createError}</p>}
                {creating && (
                  <div className="flex justify-center">
                    <svg className="w-5 h-5 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  </div>
                )}
                <button type="button" onClick={() => setCreateStep("info")} disabled={creating} className="text-[12px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer">
                  ← Back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showPicker && (
        <ContactPicker
          title={`Add contacts to "${name.trim()}"`}
          confirmLabel="Add to list"
          onCancel={handlePickerCancel}
          onConfirm={handlePickerConfirm}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-6 w-[380px] max-w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">Delete &quot;{deleteTarget.name}&quot;?</h3>
                <p className="text-[12px] text-gray-400 mt-0.5">This won&apos;t delete the contacts themselves.</p>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-[13px] font-semibold text-white transition-colors cursor-pointer">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
