"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  apiGetCustomersFiltered,
  apiGetFilteredCustomerIds,
  apiCreateSegment,
  apiDeleteCustomer,
  apiBulkDeleteCustomers,
  apiGetConversations,
  apiGetCustomer,
  apiCreateCustomer,
  apiUpdateCustomer,
  apiCreateConversation,
  apiGetTemplates,
  apiSendTemplate,
} from "@/lib/api";
import type { Customer, Conversation, Template, SegmentDefinition } from "@/types";
import SegmentBuilder from "@/components/SegmentBuilder";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { isMarketingTemplate } from "@/components/OptOut";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

// ─── Phone normalization & validation ────────────────────────────────────────

function normalizePhone(raw: string): string {
  const s = raw.trim();
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits;           // +201012345678 → 201012345678
  if (digits.startsWith("00")) return digits.slice(2); // 00201012345678 → 201012345678
  // Local Egyptian number: 01XXXXXXXXX (11 digits starting with 0)
  if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 12)
    return "20" + digits.slice(1);
  return digits;
}

function isValidPhone(normalized: string): boolean {
  return /^\d{7,15}$/.test(normalized);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(customer: Customer): string {
  const src = customer.name || customer.phone;
  if (!src) return "?";
  return src
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const TAG_PALETTES = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTES[hash % TAG_PALETTES.length];
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}


function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ─── Patient field helpers ─────────────────────────────────────────────────────

function computeAge(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 200 ? age : null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

// Value for <input type="date"> (YYYY-MM-DD)
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

const GENDER_LABEL: Record<string, string> = { MALE: "Male", FEMALE: "Female" };

function getWindowStatus(conv: Conversation | undefined): { label: string; open: boolean } {
  if (!conv?.lastCustomerMessageAt) return { label: "No messages yet", open: false };
  const elapsed = Date.now() - new Date(conv.lastCustomerMessageAt).getTime();
  const remaining = 24 * 60 * 60 * 1000 - elapsed;
  if (remaining <= 0) return { label: "Closed", open: false };
  const hrs = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  const timeStr = hrs > 0 ? `${hrs}h ${mins > 0 ? ` ${mins}m` : ""} left` : `${mins}m left`;
  return { label: `Open — ${timeStr}`, open: true };
}

const STATUS_STYLES: Record<string, string> = {
  OPEN:     "bg-green-50 text-green-700 border border-green-200",
  PENDING:  "bg-amber-50 text-amber-700 border border-amber-200",
  RESOLVED: "bg-gray-100 text-gray-500 border border-gray-200",
};

// ─── Customer Detail Drawer ───────────────────────────────────────────────────

type EditingField =
  | "name" | "email" | "tags" | "notes"
  | "chartNumber" | "nationality" | "gender" | "dateOfBirth" | "joinDate" | "departments"
  | null;

interface DetailDrawerProps {
  customer: Customer | null;
  conv: Conversation | undefined;
  onClose: () => void;
  onSaved: (updated: Customer) => void;
  onDeleted: (id: number | string) => void;
}

function CustomerDetailDrawer({ customer, conv, onClose, onSaved, onDeleted }: DetailDrawerProps) {
  const { can } = useCurrentUser();
  const canDelete = can("contact:delete");
  const router = useRouter();
  const open = customer !== null;

  const [detail, setDetail] = useState<Customer | null>(null);
  const [fetching, setFetching] = useState(false);

  // Inline edit state
  const [editing, setEditing] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editGender, setEditGender] = useState<"MALE" | "FEMALE" | "">("");
  const [editDepts, setEditDepts] = useState<string[]>([]);
  const [editDeptInput, setEditDeptInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!customer) { setDetail(null); setEditing(null); setConfirmDelete(false); setDeleteError(null); return; }
    setDetail(customer);
    setEditing(null);
    const id = customer._id ?? customer.id;
    if (id == null) return;
    setFetching(true);
    apiGetCustomer(String(id))
      .then((res) => setDetail(res.data))
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [customer]);

  const c = detail ?? customer;
  const window_ = getWindowStatus(conv);

  function startEdit(field: EditingField) {
    if (!c) return;
    setSaveError(null);
    setEditing(field);
    if (field === "name") setEditValue(c.name ?? "");
    else if (field === "email") setEditValue(c.email ?? "");
    else if (field === "notes") setEditValue(c.notes ?? "");
    else if (field === "chartNumber") setEditValue(c.chartNumber ?? "");
    else if (field === "nationality") setEditValue(c.nationality ?? "");
    else if (field === "dateOfBirth") setEditValue(toDateInput(c.dateOfBirth));
    else if (field === "joinDate") setEditValue(toDateInput(c.joinDate));
    else if (field === "gender") setEditGender(c.gender ?? "");
    else if (field === "tags") { setEditTags([...(c.tags ?? [])]); setEditTagInput(""); }
    else if (field === "departments") { setEditDepts([...(c.departments ?? [])]); setEditDeptInput(""); }
  }

  function cancelEdit() {
    setEditing(null); setEditValue(""); setEditTags([]); setEditTagInput("");
    setEditGender(""); setEditDepts([]); setEditDeptInput(""); setSaveError(null);
  }

  async function saveField() {
    if (!c) return;
    const id = c._id ?? c.id;
    if (id == null) return;
    // Validate before saving
    if (editing === "email" && editValue.trim() && !isValidEmail(editValue)) {
      setSaveError("Enter a valid email address."); return;
    }
    if (editing === "name" && editValue.trim().length > 100) {
      setSaveError("Name must be 100 characters or fewer."); return;
    }
    if (editing === "notes" && editValue.trim().length > 1000) {
      setSaveError("Notes must be 1000 characters or fewer."); return;
    }
    setSaving(true); setSaveError(null);
    try {
      const payload: Partial<{
        name: string; email: string; tags: string[]; notes: string;
        chartNumber: string | null; nationality: string | null;
        gender: "MALE" | "FEMALE" | null; dateOfBirth: string | null;
        joinDate: string | null; departments: string[];
      }> = {};
      if (editing === "name") payload.name = editValue.trim() || undefined;
      else if (editing === "email") payload.email = editValue.trim() || undefined;
      else if (editing === "notes") payload.notes = editValue.trim() || undefined;
      else if (editing === "tags") payload.tags = editTags;
      else if (editing === "chartNumber") payload.chartNumber = editValue.trim() || null;
      else if (editing === "nationality") payload.nationality = editValue.trim() || null;
      else if (editing === "dateOfBirth") payload.dateOfBirth = editValue || null;
      else if (editing === "joinDate") payload.joinDate = editValue || null;
      else if (editing === "gender") payload.gender = editGender || null;
      else if (editing === "departments") payload.departments = editDepts;
      const res = await apiUpdateCustomer(id, payload);
      setDetail(res.data);
      onSaved(res.data);
      cancelEdit();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Pencil icon button
  const PencilBtn = ({ field }: { field: EditingField }) => (
    <button
      type="button"
      onClick={() => startEdit(field)}
      className="w-5 h-5 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>
  );

  // Save / cancel row
  const EditActions = () => (
    <div className="flex items-center gap-1.5 mt-2">
      <button
        type="button"
        onClick={saveField}
        disabled={saving}
        className="flex items-center gap-1 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-60 px-3 py-1 rounded-lg transition-colors cursor-pointer"
      >
        {saving ? (
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        ) : (
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
        Save
      </button>
      <button
        type="button"
        onClick={cancelEdit}
        className="text-[12px] font-semibold text-gray-500 hover:text-gray-700 px-2.5 py-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
      >
        Cancel
      </button>
      {saveError && <p className="text-[11px] text-red-500">{saveError}</p>}
    </div>
  );

  // Field label row with pencil
  function FieldLabel({ label, field }: { label: string; field: EditingField }) {
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        {editing !== field && <PencilBtn field={field} />}
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[49] bg-black/20 transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] z-[50] bg-white shadow-2xl border-l border-gray-100 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {!c ? null : (
          <>
            {/* Header */}
            <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-full bg-brand-200 flex items-center justify-center text-brand-fg font-bold text-[14px] shrink-0">
                    {getInitials(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editing === "name" ? (
                      <div>
                        <input
                          autoFocus
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }}
                          className="w-full text-[15px] font-bold text-gray-900 border border-brand rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand/20"
                        />
                        <EditActions />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <p className="text-[16px] font-bold text-gray-900 truncate">
                          {c.name || <span className="text-gray-400 font-normal text-[14px]">No name</span>}
                        </p>
                        <PencilBtn field="name" />
                      </div>
                    )}
                    {editing !== "name" && <p className="text-[13px] text-gray-500 mt-0.5">{c.phone}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer shrink-0 mt-0.5"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
              {fetching && (
                <div className="mt-2 h-0.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full w-1/2 bg-brand/30 animate-pulse rounded-full" />
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">

              {/* Patient Info */}
              <div className="space-y-4">
                <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">Patient Info</p>

                {/* Chart Number */}
                <div>
                  <FieldLabel label="Chart Number" field="chartNumber" />
                  {editing === "chartNumber" ? (
                    <div>
                      <input autoFocus type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }} placeholder="e.g. CH-00123" className="w-full text-[14px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20 placeholder:text-gray-300" />
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700 font-mono">{c.chartNumber || <span className="text-gray-300 font-sans">—</span>}</p>
                  )}
                </div>

                {/* Gender */}
                <div>
                  <FieldLabel label="Gender" field="gender" />
                  {editing === "gender" ? (
                    <div>
                      <div className="flex gap-2">
                        {(["MALE", "FEMALE"] as const).map((g) => (
                          <button key={g} type="button" onClick={() => setEditGender((prev) => (prev === g ? "" : g))}
                            className={`flex-1 py-2 rounded-lg border text-[13px] font-semibold transition-colors cursor-pointer ${editGender === g ? "border-brand bg-brand-100 text-brand-fg" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                            {GENDER_LABEL[g]}
                          </button>
                        ))}
                      </div>
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700">{c.gender ? GENDER_LABEL[c.gender] : <span className="text-gray-300">—</span>}</p>
                  )}
                </div>

                {/* Date of Birth */}
                <div>
                  <FieldLabel label="Date of Birth" field="dateOfBirth" />
                  {editing === "dateOfBirth" ? (
                    <div>
                      <input autoFocus type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }} className="w-full text-[14px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20" />
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700">
                      {c.dateOfBirth ? (
                        <>{formatDate(c.dateOfBirth)}{computeAge(c.dateOfBirth) != null && <span className="text-gray-400"> · {computeAge(c.dateOfBirth)} yrs</span>}</>
                      ) : <span className="text-gray-300">—</span>}
                    </p>
                  )}
                </div>

                {/* Nationality */}
                <div>
                  <FieldLabel label="Nationality" field="nationality" />
                  {editing === "nationality" ? (
                    <div>
                      <input autoFocus type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }} placeholder="e.g. Egyptian" className="w-full text-[14px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20 placeholder:text-gray-300" />
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700">{c.nationality || <span className="text-gray-300">—</span>}</p>
                  )}
                </div>

                {/* Join Date */}
                <div>
                  <FieldLabel label="Join Date" field="joinDate" />
                  {editing === "joinDate" ? (
                    <div>
                      <input autoFocus type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }} className="w-full text-[14px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20" />
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700">{c.joinDate ? formatDate(c.joinDate) : <span className="text-gray-300">—</span>}</p>
                  )}
                </div>

                {/* Departments */}
                <div>
                  <FieldLabel label="Departments" field="departments" />
                  {editing === "departments" ? (
                    <div>
                      <div className="border border-brand rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-brand/20 bg-white">
                        {editDepts.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {editDepts.map((dep, idx) => (
                              <span key={dep} className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full ${idx === 0 ? "bg-brand text-white" : "bg-gray-100 text-gray-600"}`}>
                                {idx === 0 && <span className="text-[10px] opacity-80">TOP</span>}
                                {dep}
                                <button type="button" onClick={() => setEditDepts((p) => p.filter((d) => d !== dep))} className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-black/10 cursor-pointer leading-none">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <input autoFocus={editDepts.length === 0} type="text" value={editDeptInput} onChange={(e) => setEditDeptInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); const d = editDeptInput.trim(); if (d && !editDepts.includes(d)) setEditDepts((p) => [...p, d]); setEditDeptInput(""); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          placeholder="Add in priority order…" className="w-full text-[13px] text-gray-700 placeholder:text-gray-300 outline-none bg-transparent" />
                      </div>
                      <EditActions />
                    </div>
                  ) : (
                    c.departments && c.departments.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {c.departments.map((dep, idx) => (
                          <span key={dep} className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${idx === 0 ? "bg-brand text-white" : "bg-gray-100 text-gray-600"}`}>
                            {idx === 0 ? `Top: ${dep}` : dep}
                          </span>
                        ))}
                      </div>
                    ) : <p className="text-[13px] text-gray-300">—</p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Contact Info */}
              <div className="space-y-4">
                <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">Contact Info</p>

                {/* Email */}
                <div>
                  <FieldLabel label="Email" field="email" />
                  {editing === "email" ? (
                    <div>
                      <input
                        autoFocus
                        type="email"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveField(); if (e.key === "Escape") cancelEdit(); }}
                        placeholder="name@example.com"
                        className="w-full text-[14px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20 placeholder:text-gray-300"
                      />
                      <EditActions />
                    </div>
                  ) : (
                    <p className="text-[14px] text-gray-700">
                      {c.email || <span className="text-gray-300">—</span>}
                    </p>
                  )}
                </div>

                {/* Tags */}
                <div>
                  <FieldLabel label="Tags" field="tags" />
                  {editing === "tags" ? (
                    <div>
                      <div className="border border-brand rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-brand/20 bg-white">
                        {editTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {editTags.map((tag) => (
                              <span key={tag} className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full ${tagColor(tag)}`}>
                                {tag}
                                <button type="button" onClick={() => setEditTags((p) => p.filter((t) => t !== tag))} className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-black/10 cursor-pointer leading-none">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <input
                          autoFocus={editTags.length === 0}
                          type="text"
                          value={editTagInput}
                          onChange={(e) => setEditTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); const t = editTagInput.trim(); if (t && !editTags.includes(t)) setEditTags((p) => [...p, t]); setEditTagInput(""); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                          placeholder="Type and press Enter…"
                          className="w-full text-[13px] text-gray-700 placeholder:text-gray-300 outline-none bg-transparent"
                        />
                      </div>
                      <EditActions />
                    </div>
                  ) : (
                    c.tags && c.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {c.tags.map((tag) => (
                          <span key={tag} className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${tagColor(tag)}`}>{tag}</span>
                        ))}
                      </div>
                    ) : <p className="text-[13px] text-gray-300">—</p>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <FieldLabel label="Notes" field="notes" />
                  {editing === "notes" ? (
                    <div>
                      <textarea
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                        rows={4}
                        placeholder="Add notes…"
                        className="w-full text-[13.5px] text-gray-800 border border-brand rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand/20 resize-none placeholder:text-gray-300"
                      />
                      <EditActions />
                    </div>
                  ) : (
                    c.notes
                      ? <p className="text-[13.5px] text-gray-700 leading-relaxed whitespace-pre-wrap">{c.notes}</p>
                      : <p className="text-[13px] text-gray-300">—</p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100" />

              {/* Conversation */}
              <div className="space-y-4">
                <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">Conversation</p>

                {conv ? (
                  <>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Status</p>
                      <span className={`inline-block text-[12px] font-semibold px-2.5 py-0.5 rounded-full ${STATUS_STYLES[conv.status] ?? STATUS_STYLES.RESOLVED}`}>
                        {conv.status}
                      </span>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Assigned to</p>
                      {conv.assignedAgent
                        ? <p className="text-[14px] text-gray-700">{conv.assignedAgent.username}</p>
                        : <p className="text-[13px] text-gray-400 italic">Unassigned</p>}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Last message</p>
                      <p className="text-[14px] text-gray-700">
                        {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Window</p>
                      <p className={`text-[14px] font-medium ${window_.open ? "text-green-600" : "text-red-500"}`}>
                        {window_.label}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => { onClose(); router.push(`/chats/${conv.id}`); }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand hover:bg-[#2f5840] text-white text-[13px] font-semibold transition-colors cursor-pointer"
                    >
                      Open Conversation
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </button>
                  </>
                ) : (
                  <p className="text-[13px] text-gray-400 italic">No conversation yet</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-gray-100 px-5 py-4 space-y-3">
              <p className="text-[12px] text-gray-400">
                Member since <span className="font-medium text-gray-500">{formatMemberSince(c.createdAt)}</span>
              </p>

              {confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-[12px] text-red-500 font-medium">Delete this contact? Their whole chat history is deleted permanently — this cannot be undone. (If they opted out, that is kept.)</p>
                  {deleteError && <p className="text-[11px] text-red-500">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                      className="flex-1 py-2 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={async () => {
                        const id = c._id ?? c.id;
                        if (id == null) return;
                        setDeleting(true);
                        setDeleteError(null);
                        try {
                          await apiDeleteCustomer(id);
                          onDeleted(id);
                          onClose();
                        } catch (err) {
                          setDeleteError(err instanceof Error ? err.message : "Failed to delete");
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {deleting ? (
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      )}
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ) : (
                canDelete && <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Delete contact
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 animate-pulse">
      <td className="px-4 py-3.5"><div className="w-4 h-4 rounded bg-gray-200" /></td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3 bg-gray-200 rounded w-28" />
            <div className="h-2.5 bg-gray-100 rounded w-20" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-12" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-8" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-20" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-20" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-32" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3.5"><div className="flex gap-2"><div className="h-7 bg-gray-100 rounded-lg w-20" /></div></td>
    </tr>
  );
}


// ─── New Contact Drawer ──────────────────────────────────────────────────────

interface NewDrawerProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function NewCustomerDrawer({ open, onClose, onCreated }: NewDrawerProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // Patient fields
  const [chartNumber, setChartNumber] = useState("");
  const [nationality, setNationality] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "">("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [joinDate, setJoinDate] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [deptInput, setDeptInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const phoneRef = useRef<HTMLInputElement>(null);

  // Live normalized preview
  const normalizedPreview = phone.trim() ? normalizePhone(phone) : "";
  const phonePreviewValid = normalizedPreview ? isValidPhone(normalizedPreview) : null;

  useEffect(() => {
    if (open) {
      setPhone(""); setName(""); setEmail(""); setNotes("");
      setTags([]); setTagInput(""); setApiError(null); setErrors({});
      setChartNumber(""); setNationality(""); setGender("");
      setDateOfBirth(""); setJoinDate(""); setDepartments([]); setDeptInput("");
      setTimeout(() => phoneRef.current?.focus(), 150);
    }
  }, [open]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const normalized = normalizePhone(phone);
    if (!phone.trim()) errs.phone = "Phone number is required.";
    else if (!isValidPhone(normalized)) errs.phone = "Invalid phone number — couldn't parse it to a valid international number.";
    if (email.trim() && !isValidEmail(email)) errs.email = "Enter a valid email address.";
    if (name.trim().length > 100) errs.name = "Name must be 100 characters or fewer.";
    if (notes.trim().length > 1000) errs.notes = "Notes must be 1000 characters or fewer.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) { phoneRef.current?.focus(); return; }
    setSubmitting(true); setApiError(null);
    try {
      await apiCreateCustomer({
        phone: normalizePhone(phone),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(chartNumber.trim() ? { chartNumber: chartNumber.trim() } : {}),
        ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
        ...(gender ? { gender } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(joinDate ? { joinDate } : {}),
        ...(departments.length > 0 ? { departments } : {}),
      });
      onCreated(); onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to create contact");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full text-[14px] text-gray-800 border rounded-xl px-4 py-3 outline-none placeholder:text-gray-400 transition-colors ${
      errors[field]
        ? "border-red-400 bg-red-50 focus:ring-2 focus:ring-red-200"
        : "border-gray-200 bg-white focus:ring-2 focus:ring-brand/20 focus:border-brand"
    }`;

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col justify-end transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white rounded-t-2xl shadow-2xl px-5 pt-4 pb-10 transition-transform duration-300 ease-out max-h-[92dvh] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full ${open ? "translate-y-0" : "translate-y-full"}`}>
        <div className="w-9 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[17px] font-bold text-gray-900">New Contact</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mobile */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700">Mobile <span className="text-red-500">*</span></label>
            <input
              ref={phoneRef}
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setErrors((p) => ({ ...p, phone: "" })); }}
              placeholder="+20 101 234 5678 or 01012345678"
              className={inputCls("phone")}
            />
            {/* Live preview */}
            {normalizedPreview && (
              <p className={`text-[12px] flex items-center gap-1 ${phonePreviewValid ? "text-green-600" : "text-amber-600"}`}>
                {phonePreviewValid ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
                )}
                Will be stored as: <span className="font-mono font-semibold">{normalizedPreview}</span>
              </p>
            )}
            {errors.phone && <p className="text-[12px] text-red-500">{errors.phone}</p>}
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-gray-700">Name</label>
              {name.length > 80 && <span className={`text-[11px] ${name.length > 100 ? "text-red-500" : "text-gray-400"}`}>{name.length}/100</span>}
            </div>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: "" })); }} placeholder="Full name" className={inputCls("name")} />
            {errors.name && <p className="text-[12px] text-red-500">{errors.name}</p>}
          </div>

          {/* Chart Number */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700">Chart Number</label>
            <input type="text" value={chartNumber} onChange={(e) => setChartNumber(e.target.value)} placeholder="e.g. CH-00123" className={inputCls("chartNumber")} />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700">Email</label>
            <input type="text" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: "" })); }} placeholder="name@example.com" className={inputCls("email")} />
            {errors.email && <p className="text-[12px] text-red-500">{errors.email}</p>}
          </div>

          {/* Gender + Date of birth */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">Gender</label>
              <div className="flex gap-2">
                {(["MALE", "FEMALE"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender((prev) => (prev === g ? "" : g))}
                    className={`flex-1 py-3 rounded-xl border text-[13px] font-semibold transition-colors cursor-pointer ${
                      gender === g
                        ? "border-brand bg-brand-100 text-brand-fg"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {GENDER_LABEL[g]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">Date of Birth</label>
              <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputCls("dateOfBirth")} />
              {dateOfBirth && computeAge(dateOfBirth) != null && (
                <p className="text-[12px] text-gray-400">Age: {computeAge(dateOfBirth)}</p>
              )}
            </div>
          </div>

          {/* Nationality + Join date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">Nationality</label>
              <input type="text" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. Egyptian" className={inputCls("nationality")} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">Join Date</label>
              <input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} className={inputCls("joinDate")} />
            </div>
          </div>

          {/* Departments (ordered — first = top department) */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700">Departments <span className="text-gray-400 font-normal">— first is the top department</span></label>
            <div className="border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-colors">
              {departments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {departments.map((dep, idx) => (
                    <span key={dep} className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full ${idx === 0 ? "bg-brand text-white" : "bg-gray-100 text-gray-600"}`}>
                      {idx === 0 && <span className="text-[10px] opacity-80">TOP</span>}
                      {dep}
                      <button type="button" onClick={() => setDepartments((p) => p.filter((d) => d !== dep))} className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors cursor-pointer leading-none">×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={deptInput}
                onChange={(e) => setDeptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const d = deptInput.trim();
                    if (!d) return;
                    if (!departments.includes(d)) setDepartments((p) => [...p, d]);
                    setDeptInput("");
                  }
                }}
                placeholder="Type and press Enter (add in priority order)"
                className="w-full text-[13px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700">Tags</label>
            <div className="border border-gray-200 rounded-xl px-3 py-2.5 bg-white focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-colors">
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span key={tag} className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full ${tagColor(tag)}`}>
                      {tag}
                      <button type="button" onClick={() => setTags((p) => p.filter((t) => t !== tag))} className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors cursor-pointer leading-none">×</button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = tagInput.trim();
                    if (!t) return;
                    if (t.length > 30) { setErrors((p) => ({ ...p, tags: "Each tag must be 30 characters or fewer." })); return; }
                    if (tags.length >= 10) { setErrors((p) => ({ ...p, tags: "Maximum 10 tags allowed." })); return; }
                    if (!tags.includes(t)) setTags((p) => [...p, t]);
                    setTagInput("");
                    setErrors((p) => ({ ...p, tags: "" }));
                  }
                }}
                placeholder="Type and press Enter to add tag"
                className="w-full text-[13px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
              />
            </div>
            {errors.tags && <p className="text-[12px] text-red-500">{errors.tags}</p>}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-gray-700">Notes</label>
              {notes.length > 800 && <span className={`text-[11px] ${notes.length > 1000 ? "text-red-500" : "text-gray-400"}`}>{notes.length}/1000</span>}
            </div>
            <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setErrors((p) => ({ ...p, notes: "" })); }} placeholder="Any additional notes…" rows={3} className={`${inputCls("notes")} resize-none`} />
            {errors.notes && <p className="text-[12px] text-red-500">{errors.notes}</p>}
          </div>

          {apiError && <p className="text-[13px] text-red-500 font-medium text-center">{apiError}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 py-3 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-60 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer">{submitting ? "Creating…" : "Create Contact"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Send Template Drawer ─────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  GENERAL:  "bg-blue-50 text-blue-600",
  CAMPAIGN: "bg-purple-50 text-purple-600",
};
const CATEGORY_LABELS: Record<string, string> = {
  GENERAL:  "General",
  CAMPAIGN: "Campaign",
};

interface SendTemplateDrawerProps {
  customer: Customer | null;
  onClose: () => void;
  onSent: (conv: Conversation) => void;
}

function SendTemplateDrawer({ customer, onClose, onSent }: SendTemplateDrawerProps) {
  const router = useRouter();
  const open = customer !== null;
  // Agents send general and utility templates only; marketing ones stay hidden.
  const canMarketing = useCurrentUser().can("template:send_marketing");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setSelected(null); setError(null); return; }
    setLoadingTemplates(true);
    apiGetTemplates({ status: "APPROVED" })
      .then((res) => {
        // Not-yet-set-up imported templates can't be sent (needsSetup).
        setTemplates(res.data.filter((t) => (t.category === "GENERAL" || t.category === "CAMPAIGN") && !t.needsSetup?.length && (canMarketing || !isMarketingTemplate(t))));
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [open, canMarketing]);

  async function handleSend() {
    if (!customer || selected == null) return;
    const id = customer._id ?? customer.id;
    if (id == null) return;
    setSending(true);
    setError(null);
    try {
      const convRes = await apiCreateConversation(Number(id));
      const conv = convRes.data;
      await apiSendTemplate(String(conv.id), selected);
      onSent(conv);
      onClose();
      router.push(`/chats/${conv.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const selectedTemplate = templates.find((t) => t.id === selected);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[49] bg-black/20 transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />
      <div
        className={`fixed top-0 right-0 h-full w-[420px] z-[50] bg-white shadow-2xl border-l border-gray-100 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Send Template</p>
              <p className="text-[16px] font-bold text-gray-900 truncate">
                {customer?.name || customer?.phone || "Contact"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="text-[12px] text-gray-400 mt-2">
            Pick an approved template to start the conversation.
          </p>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loadingTemplates ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-5 h-5 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center mb-1">
                <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/></svg>
              </div>
              <p className="text-[14px] font-semibold text-gray-700">No approved templates</p>
              <p className="text-[13px] text-gray-400">Create and submit a GENERAL or CAMPAIGN template first.</p>
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors cursor-pointer ${
                  selected === t.id
                    ? "border-brand bg-brand-100 ring-1 ring-brand/20"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[13px] font-semibold text-gray-900 truncate">{t.name}</p>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[t.category] ?? "bg-gray-100 text-gray-500"}`}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                </div>
                <p className="text-[12px] text-gray-500 line-clamp-2 leading-relaxed">{t.body}</p>
              </button>
            ))
          )}
        </div>

        {/* Template preview */}
        {selectedTemplate && (
          <div className="shrink-0 border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Preview</p>
            <div className="bg-white rounded-xl border border-gray-200 px-3 py-3 space-y-1.5 text-[12px] leading-relaxed text-gray-700">
              {selectedTemplate.header && (
                <p className="font-semibold text-gray-900">{selectedTemplate.header}</p>
              )}
              <p className="whitespace-pre-wrap">{selectedTemplate.body}</p>
              {selectedTemplate.footer && (
                <p className="text-gray-400 text-[11px]">{selectedTemplate.footer}</p>
              )}
              {selectedTemplate.buttons && selectedTemplate.buttons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100">
                  {selectedTemplate.buttons.map((btn) => (
                    <span key={btn.id} className="text-[11px] font-semibold text-brand-fg border border-brand/30 rounded-lg px-2 py-0.5">{btn.title}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-4">
          {error && <p className="text-[12px] text-red-500 mb-2">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={selected == null || sending}
              className="flex-1 py-2.5 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {sending ? (
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z"/></svg>
              )}
              {sending ? "Sending…" : "Send Template"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CRMPage() {
  // Everyone who reaches Contacts can view and edit contacts; everything below
  // is shown only to roles whose permissions include it (see CurrentUserProvider).
  const { can } = useCurrentUser();
  const canImport = can("contact:import");
  const canBulkDelete = can("contact:bulk_delete");
  const canSaveSegment = can("segment:write");
  const canOpenChat = can("conversation:write");
  const canMessage = can("message:send", "conversation:write");
  const canCampaign = can("campaign:write", "campaign:send");
  const router = useRouter();


  // ─ Customer list state ─────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  // An ad-hoc segment rule layered on top of the search box. Held here rather
  // than in the builder so paging, "select all matching" and "save as segment"
  // all read the same definition the table was filtered by.
  const [filterDef, setFilterDef] = useState<SegmentDefinition>({ match: "ALL", rules: [] });
  const [showFilters, setShowFilters] = useState(false);
  const [savingSegment, setSavingSegment] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [showSaveSegment, setShowSaveSegment] = useState(false);
  const [saveSegmentError, setSaveSegmentError] = useState<string | null>(null);

  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  // ─ Conversation map (customerId → Conversation) ────────────────────────────
  const [convMap, setConvMap] = useState<Map<number | string, Conversation>>(new Map());

  // ─ UI state ────────────────────────────────────────────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [templateTarget, setTemplateTarget] = useState<Customer | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─ Bulk selection state ─────────────────────────────────────────────────────
  // Keyed by String(_id ?? id) — same identity scheme the page already uses for
  // dedup. Holds the full record so Export/Create-campaign work across pages,
  // not just the rows currently loaded into the table.
  const [selectedMap, setSelectedMap] = useState<Map<string, Customer>>(new Map());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  // Set when "select all matching" couldn't reach every row (search matches more
  // than the client can page through at once). { reachable, total }.
  const [matchCap, setMatchCap] = useState<{ reachable: number; total: number } | null>(null);
  // Bulk delete
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // ─ Fetch conversations once (build lookup map) ─────────────────────────────
  // Only with inbox access: MARKETING sees contacts, never their chats.
  const canReadChats = can("conversation:read");
  useEffect(() => {
    if (!canReadChats) return;
    apiGetConversations(1, 200)
      .then((res) => {
        const map = new Map<number | string, Conversation>();
        for (const conv of res.data) {
          const cid = conv.customerId;
          if (cid != null) map.set(cid, conv);
        }
        setConvMap(map);
      })
      .catch(() => {});
  }, [canReadChats]);

  // Mirrors searchRef: paging callbacks are memoised, so they need a ref to
  // read the CURRENT filter rather than the one captured when they were made.
  const filterRef = useRef<SegmentDefinition>(filterDef);
  filterRef.current = filterDef;
  const activeRuleCount = filterDef.rules.length;
  // Structural identity of the rule, so the refetch effect fires when the rule
  // actually changed rather than on every render that rebuilt the object.
  const filterKey = JSON.stringify(filterDef);

  // ─ Initial + search fetch ──────────────────────────────────────────────────
  const fetchPage1 = useCallback(async (q: string, def?: SegmentDefinition) => {
    setLoading(true);
    pageRef.current = 1;
    try {
      const res = await apiGetCustomersFiltered(1, PAGE_SIZE, q, def ?? filterRef.current);
      setCustomers(res.data);
      const more = res.data.length >= PAGE_SIZE;
      setHasMore(more);
      hasMoreRef.current = more;
    } catch {
      setCustomers([]);
      setHasMore(false);
      hasMoreRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ─ Load more (infinite scroll) ────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const res = await apiGetCustomersFiltered(nextPage, PAGE_SIZE, searchRef.current, filterRef.current);
      setCustomers((prev) => {
        // Guard against overlapping pages returning a row we already have.
        const seen = new Set(prev.map((c) => String(c._id ?? c.id)));
        const fresh = res.data.filter((c) => !seen.has(String(c._id ?? c.id)));
        return [...prev, ...fresh];
      });
      const more = res.data.length >= PAGE_SIZE;
      setHasMore(more);
      hasMoreRef.current = more;
      pageRef.current = nextPage;
    } catch {
      // swallow, just stop loading
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  // ─ IntersectionObserver for infinite scroll ────────────────────────────────
  // Root is the page's own scroll container (the dashboard shell is fixed-height
  // and clips overflow, so the window never scrolls — see the render below).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { root: scrollRef.current, rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // ─ Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage1(search, filterDef), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // filterKey (not filterDef) so an identical rule rebuilt on re-render
    // does not retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterKey, fetchPage1]);

  // ─ Export CSV ─────────────────────────────────────────────────────────────
  function downloadCustomersCSV(list: Customer[], filenamePrefix: string) {
    const header = ["id", "chartNumber", "name", "mobile", "email", "nationality", "gender", "dateOfBirth", "age", "joinDate", "departments", "topDepartment", "tags", "notes", "createdAt", "lastMessage", "waitingResponse", "assignedAgent"];
    const rows = list.map((c) => {
      const id = c._id ?? c.id ?? "";
      const conv = convMap.get(Number(id)) ?? convMap.get(String(id));
      const age = computeAge(c.dateOfBirth);
      return [
        String(id),
        c.chartNumber ?? "",
        c.name ?? "",
        c.phone,
        c.email ?? "",
        c.nationality ?? "",
        c.gender ? GENDER_LABEL[c.gender] : "",
        c.dateOfBirth ? toDateInput(c.dateOfBirth) : "",
        age != null ? String(age) : "",
        c.joinDate ? toDateInput(c.joinDate) : "",
        (c.departments ?? []).join(";"),
        c.departments?.[0] ?? "",
        (c.tags ?? []).join(";"),
        c.notes ?? "",
        c.createdAt,
        conv?.lastMessage ?? "",
        conv?.lastSenderType === "CUSTOMER" ? "yes" : "no",
        conv?.assignedAgent?.username ?? "",
      ].map(csvEscape).join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    downloadCustomersCSV(customers, "contacts");
  }

  // ─ Bulk selection helpers ──────────────────────────────────────────────────
  const customerKey = (c: Customer) => String(c._id ?? c.id);
  const isSelected = (c: Customer) => selectedMap.has(customerKey(c));
  const someLoadedSelected = customers.some(isSelected);

  function toggleCustomer(c: Customer) {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      const k = customerKey(c);
      if (next.has(k)) next.delete(k);
      else next.set(k, c);
      return next;
    });
    setSelectAllMatching(false);
    setMatchCap(null);
  }

  // Header checkbox: "check all" selects EVERY matching contact (across all
  // pages), or clears the selection if everything is already selected.
  function toggleSelectAll() {
    if (selectAllMatching) clearSelection();
    else selectAllMatchingCustomers();
  }

  function clearSelection() {
    setSelectedMap(new Map());
    setSelectAllMatching(false);
    setMatchCap(null);
  }

  // Fetch every customer matching the current search (across all pages) and add
  // them to the selection — the "select all N matching" tier. Mirrors the paging
  // strategy the campaign wizard uses (backend caps page size at 100).
  async function selectAllMatchingCustomers() {
    setSelectingAll(true);
    try {
      // One request for every matching id, resolved server-side. The old
      // approach paged through rows 100 at a time and gave up at 5,000, which
      // meant "select all 8,000 matching" quietly selected 5,000 — the failure
      // mode a targeted campaign can least afford. The server now refuses
      // outright above its cap instead of silently truncating.
      const idsRes = await apiGetFilteredCustomerIds(searchRef.current, filterRef.current);
      const ids = new Set(idsRes.data.customerIds);

      // Rows already paged in carry their full record, so keep those; the rest
      // are held as id-only stubs, which is all the bulk actions need.
      setSelectedMap((prev) => {
        const next = new Map(prev);
        const loaded = new Map(customers.map((c) => [Number(c.id), c]));
        ids.forEach((id) => {
          const full = loaded.get(id);
          if (full) next.set(customerKey(full), full);
          else next.set(String(id), { id } as Customer);
        });
        return next;
      });
      setSelectAllMatching(true);
      setMatchCap(null);
    } catch (err) {
      setMatchCap(null);
      setBulkDeleteError(err instanceof Error ? err.message : "Couldn't select all matching contacts");
    } finally {
      setSelectingAll(false);
    }
  }

  // Turn the filter currently on screen into a saved segment. The bridge from
  // "I found this audience once" to "this audience re-checks itself" — without
  // it, every useful filter has to be rebuilt from memory in another screen.
  async function saveFilterAsSegment() {
    if (!segmentName.trim() || activeRuleCount === 0) return;
    setSavingSegment(true);
    setSaveSegmentError(null);
    try {
      const res = await apiCreateSegment({
        name: segmentName.trim(),
        definition: filterDef,
        excludeOptedOut: true,
      });
      setShowSaveSegment(false);
      setSegmentName("");
      router.push(`/customers/segments/${res.data.id}`);
    } catch (err) {
      setSaveSegmentError(err instanceof Error ? err.message : "Couldn't save that segment");
    } finally {
      setSavingSegment(false);
    }
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedMap.values()]
      .map((c) => c.id)
      .filter((n): n is number => typeof n === "number");
    if (ids.length === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      await apiBulkDeleteCustomers(ids);
      setConfirmBulkDelete(false);
      clearSelection();
      await fetchPage1(searchRef.current);
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : "Failed to delete contacts");
    } finally {
      setBulkDeleting(false);
    }
  }

  function exportSelectedCSV() {
    downloadCustomersCSV([...selectedMap.values()], "contacts-selected");
  }

  // Hand the selected customers off to the campaign wizard as pre-seeded
  // recipients. Only numeric ids are valid campaign recipient ids.
  function createCampaignFromSelected() {
    const ids = [...selectedMap.values()]
      .map((c) => c.id)
      .filter((n): n is number => typeof n === "number");
    if (ids.length === 0) return;
    router.push(`/campaigns/new?recipients=${ids.join(",")}`);
  }

  // ─ Template download ───────────────────────────────────────────────────────
  function downloadTemplate() {
    const csv =
      "chart_number,name,phone,email,nationality,gender,date_of_birth,join_date,departments,tags,notes\n" +
      "CH-00123,John Doe,+201001234567,john@example.com,Egyptian,Male,1990-05-14,2023-01-20,\"Facial;Laser\",\"VIP;lead\",Follow up";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─ Conversation lookup helper ─────────────────────────────────────────────
  function getConv(customer: Customer): Conversation | undefined {
    const id = customer._id ?? customer.id;
    if (id == null) return undefined;
    return convMap.get(Number(id)) ?? convMap.get(String(id));
  }

  // ─ Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col min-h-0 bg-white font-[family-name:var(--font-geist-sans)]">
      {/* Drawers & modals */}
      <CustomerDetailDrawer
        customer={detailCustomer}
        conv={detailCustomer ? getConv(detailCustomer) : undefined}
        onClose={() => setDetailCustomer(null)}
        onDeleted={(id) => {
          setCustomers((prev) => prev.filter((c) => String(c._id ?? c.id) !== String(id)));
          setSelectedMap((prev) => {
            if (!prev.has(String(id))) return prev;
            const next = new Map(prev);
            next.delete(String(id));
            return next;
          });
          setDetailCustomer(null);
        }}
        onSaved={(updated) => {
          setCustomers((prev) =>
            prev.map((c) => {
              const cid = c._id ?? c.id;
              const uid = updated._id ?? updated.id;
              return String(cid) === String(uid) ? updated : c;
            })
          );
        }}
      />
      <NewCustomerDrawer
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => fetchPage1(searchRef.current)}
      />
      <SendTemplateDrawer
        customer={templateTarget}
        onClose={() => setTemplateTarget(null)}
        onSent={(conv) => {
          const cid = conv.customerId;
          if (cid != null) {
            setConvMap((prev) => {
              const next = new Map(prev);
              next.set(Number(cid), conv);
              next.set(String(cid), conv);
              return next;
            });
          }
        }}
      />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Contacts</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">Your patient and contact database</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canImport && (
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:bg-gray-50 text-[13px] font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Template
          </button>
          )}
          {canImport && (
          <button
            type="button"
            onClick={() => router.push("/customers/import")}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-[13px] font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          )}
          <button
            type="button"
            onClick={exportCSV}
            disabled={customers.length === 0}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-[13px] font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-brand hover:bg-[#2f5840] active:bg-[#264a33] text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Contact
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="shrink-0 px-6 py-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 w-full max-w-sm focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-colors">
          <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email…"
            className="flex-1 text-[14px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-[13px] font-semibold transition-colors cursor-pointer ${
              activeRuleCount > 0 || showFilters
                ? "border-brand bg-brand-100 text-brand-fg"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
            Filter
            {activeRuleCount > 0 && (
              <span className="bg-brand text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {activeRuleCount}
              </span>
            )}
          </button>

          {activeRuleCount > 0 && (
            <>
              {canSaveSegment && (
              <button
                type="button"
                onClick={() => setShowSaveSegment(true)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-brand-100 hover:border-brand hover:text-brand-fg transition-colors cursor-pointer"
                title="Turn this filter into a reusable segment"
              >
                Save as segment
              </button>
              )}
              <button
                type="button"
                onClick={() => setFilterDef({ match: "ALL", rules: [] })}
                className="text-[12.5px] font-medium text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
              >
                Clear
              </button>
            </>
          )}
        </div>

        {showFilters && (
          <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
            <SegmentBuilder
              definition={filterDef}
              onChange={setFilterDef}
              excludeOptedOut={false}
              onExcludeOptedOutChange={() => {}}
            />
          </div>
        )}
      </div>

      {/* Table (this is the page's scroll container — both axes) */}
      <div
        ref={scrollRef}
        onScroll={(e) => setShowBackToTop(e.currentTarget.scrollTop > 400)}
        className="flex-1 min-h-0 overflow-auto px-6 pb-10 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full"
      >
        <table className="w-full border-collapse min-w-[1100px]">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e7eb] w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all matching contacts"
                  checked={selectAllMatching}
                  ref={(el) => { if (el) el.indeterminate = !selectAllMatching && someLoadedSelected; }}
                  onChange={toggleSelectAll}
                  disabled={loading || selectingAll || customers.length === 0}
                  className="w-4 h-4 rounded border-gray-300 text-brand-fg accent-brand cursor-pointer align-middle"
                />
              </th>
              {["Patient", "Gender", "Age", "Nationality", "Top Dept", "Join Date", "Email", "Activity", ""].map((h, hi) => (
                <th key={hi} className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e5e7eb] text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && selectingAll && (
              <tr>
                <td colSpan={10} className="px-4 py-2 text-center">
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Selecting all matching contacts…
                  </span>
                </td>
              </tr>
            )}
            {!loading && selectAllMatching && matchCap && (
              <tr className="bg-amber-50 border-b border-amber-200/60">
                <td colSpan={10} className="px-4 py-2.5 text-center">
                  <span className="text-[13px] text-amber-700">
                    Selected the first <span className="font-semibold">{matchCap.reachable.toLocaleString()}</span> of{" "}
                    <span className="font-semibold">{matchCap.total.toLocaleString()}</span> matching — the maximum at once.
                    Actions apply to these; narrow your search to reach the rest.
                    <button type="button" onClick={clearSelection} className="ml-2 font-semibold text-brand-fg hover:underline cursor-pointer">
                      Clear
                    </button>
                  </span>
                </td>
              </tr>
            )}
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                      </svg>
                    </div>
                    <p className="text-[14px] font-semibold text-gray-700">
                      {search ? "No contacts found" : "No contacts yet"}
                    </p>
                    <p className="text-[13px] text-gray-400">
                      {search ? "Try a different search term." : "Add your first contact to get started."}
                    </p>
                    {!search && (
                      <button type="button" onClick={() => setShowNew(true)} className="mt-1 flex items-center gap-1.5 bg-brand hover:bg-[#2f5840] text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        New Contact
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              customers.map((customer, i) => {
                const id = customer._id ?? customer.id;
                const conv = getConv(customer);
                const isWaiting = conv?.lastSenderType === "CUSTOMER";
                const age = computeAge(customer.dateOfBirth);
                const topDept = customer.departments?.[0];
                const extraDepts = (customer.departments?.length ?? 0) - 1;

                return (
                  <tr
                    key={id != null ? String(id) : i}
                    onClick={() => setDetailCustomer(customer)}
                    className={`border-b border-gray-100 hover:bg-brand-100 active:bg-brand-200 transition-colors duration-100 group cursor-pointer select-none ${isSelected(customer) ? "bg-brand-100" : ""}`}
                  >
                    {/* Select checkbox */}
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${customer.name || customer.phone}`}
                        checked={isSelected(customer)}
                        onChange={() => toggleCustomer(customer)}
                        className="w-4 h-4 rounded border-gray-300 text-brand-fg accent-brand cursor-pointer align-middle"
                      />
                    </td>

                    {/* Patient: name + mobile + chart # */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-200 flex items-center justify-center text-brand-fg font-semibold text-[12px] shrink-0">
                          {getInitials(customer)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-gray-900 truncate max-w-[180px]">
                            {customer.name || <span className="text-gray-400 font-normal">No name</span>}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-[12px] text-gray-400">{customer.phone}</p>
                            {customer.chartNumber && (
                              <span className="text-[10px] font-mono font-medium text-gray-400 bg-gray-100 px-1.5 rounded">#{customer.chartNumber}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Gender */}
                    <td className="px-4 py-3.5">
                      {customer.gender ? (
                        <span className="text-[13px] text-gray-600">{GENDER_LABEL[customer.gender]}</span>
                      ) : (
                        <span className="text-gray-300 text-[13px]">—</span>
                      )}
                    </td>

                    {/* Age */}
                    <td className="px-4 py-3.5">
                      {age != null ? (
                        <span className="text-[13px] text-gray-700">{age}</span>
                      ) : (
                        <span className="text-gray-300 text-[13px]">—</span>
                      )}
                    </td>

                    {/* Nationality */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] text-gray-600 truncate max-w-[120px] block">
                        {customer.nationality || <span className="text-gray-300">—</span>}
                      </span>
                    </td>

                    {/* Top Department */}
                    <td className="px-4 py-3.5">
                      {topDept ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand-fg">{topDept}</span>
                          {extraDepts > 0 && (
                            <span className="text-[11px] font-medium text-gray-400">+{extraDepts}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-[13px]">—</span>
                      )}
                    </td>

                    {/* Join Date */}
                    <td className="px-4 py-3.5">
                      {customer.joinDate ? (
                        <span className="text-[13px] text-gray-600 whitespace-nowrap">{formatDate(customer.joinDate)}</span>
                      ) : (
                        <span className="text-gray-300 text-[13px]">—</span>
                      )}
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] text-gray-500 truncate max-w-[180px] block">
                        {customer.email ?? <span className="text-gray-300">—</span>}
                      </span>
                    </td>

                    {/* Activity: last message time + waiting */}
                    <td className="px-4 py-3.5">
                      {conv?.lastMessage ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-gray-500 whitespace-nowrap">{formatRelativeTime(conv.lastMessageAt)}</span>
                          {isWaiting && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Waiting
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-[13px]">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {conv?.id != null ? (
                          canOpenChat && <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); router.push(`/chats/${conv.id}`); }}
                            className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-fg bg-brand/10 hover:bg-brand/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                            Open Chat
                          </button>
                        ) : (
                          canMessage && <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setTemplateTarget(customer); }}
                            className="flex items-center gap-1.5 text-[12px] font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z"/></svg>
                            Send Template
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />

        {/* Load more indicator */}
        {loadingMore && (
          <div className="flex items-center justify-center py-6 gap-2 text-[13px] text-gray-400">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            Loading more…
          </div>
        )}

        {!loading && !loadingMore && !hasMore && customers.length > 0 && (
          <p className="text-center text-[12px] text-gray-300 py-6">
            {customers.length} contact{customers.length !== 1 ? "s" : ""} total
          </p>
        )}
      </div>

      {/* Back to top */}
      {showBackToTop && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-[55] w-11 h-11 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-lg text-gray-500 hover:text-brand-fg hover:border-brand/40 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
      )}

      {/* Bulk action bar */}
      {selectedMap.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-white border border-gray-200 shadow-2xl rounded-2xl px-3 py-2.5">
          <span className="text-[13px] font-semibold text-gray-700 pl-2 pr-1">
            {selectedMap.size} selected
          </span>
          <div className="w-px h-6 bg-gray-200" />
          <button
            type="button"
            onClick={exportSelectedCSV}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export
          </button>
          {canCampaign && (
          <button
            type="button"
            onClick={createCampaignFromSelected}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z"/></svg>
            Create campaign
          </button>
          )}
          {canBulkDelete && (
          <button
            type="button"
            onClick={() => { setBulkDeleteError(null); setConfirmBulkDelete(true); }}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-red-500 hover:bg-red-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
          </button>
          )}
          <div className="w-px h-6 bg-gray-200" />
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Clear selection"
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 rounded-xl transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* Save the current filter as a reusable segment */}
      {showSaveSegment && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-6 w-[440px] max-w-full space-y-5">
            <div>
              <h3 className="text-[15px] font-bold text-gray-900">Save as segment</h3>
              <p className="text-[12px] text-gray-400 mt-0.5 leading-relaxed">
                Saves the rule, not the contacts. Anyone who qualifies later is included later,
                without rebuilding this filter.
              </p>
            </div>
            <div>
              <label className="text-[12px] font-semibold text-gray-600 mb-1 block">
                Segment name <span className="text-red-500">*</span>
              </label>
              <input
                value={segmentName}
                onChange={(e) => setSegmentName(e.target.value)}
                placeholder="e.g. Lapsed dermatology patients"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") saveFilterAsSegment(); }}
                className="w-full text-[13px] rounded-xl border border-gray-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors"
              />
            </div>
            {saveSegmentError && <p className="text-[12px] text-red-500">{saveSegmentError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowSaveSegment(false); setSaveSegmentError(null); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveFilterAsSegment}
                disabled={!segmentName.trim() || savingSegment}
                className="flex-1 py-2.5 rounded-xl bg-brand text-white text-[13px] font-semibold hover:bg-[#2f5840] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {savingSegment ? "Saving…" : "Save segment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-6 w-[360px] space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">
                  Delete {selectedMap.size.toLocaleString()} contact{selectedMap.size !== 1 ? "s" : ""}?
                </h3>
                <p className="text-[12px] text-gray-400 mt-0.5">This cannot be undone.</p>
              </div>
            </div>

            <p className="text-[13px] text-gray-600 leading-relaxed">
              Their whole chat history — every conversation and message — and their campaign records are deleted permanently. Opt-outs are kept, so re-adding them can&apos;t make them messageable again.
            </p>

            {bulkDeleteError && <p className="text-[12px] text-red-500">{bulkDeleteError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setConfirmBulkDelete(false); setBulkDeleteError(null); }}
                disabled={bulkDeleting}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={bulkDeleteSelected}
                disabled={bulkDeleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {bulkDeleting && (
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                )}
                {bulkDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
