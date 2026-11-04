"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { ArrowLeft, Pencil, X, Check } from "lucide-react";
import { ApiError, apiGetCustomer, apiUpdateCustomer } from "@/lib/api";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import type { Customer } from "@/types";

// ── Tag pill input ────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 min-h-[38px] px-3 py-2 border border-gray-200 rounded-xl bg-white cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 bg-brand/10 text-brand-fg text-[12px] font-medium px-2 py-0.5 rounded-full"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            className="text-brand-fg/60 hover:text-brand-fg transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(input)}
        placeholder={tags.length === 0 ? "Add tag and press Enter…" : ""}
        className="flex-1 min-w-[120px] text-[13px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
      />
    </div>
  );
}

// ── Tag pills (read-only) ─────────────────────────────────────────────────────

function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-[13px] text-gray-400 italic">No tags</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center bg-brand/10 text-brand-fg text-[12px] font-medium px-2.5 py-0.5 rounded-full"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { can } = useCurrentUser();
  // Anyone who edits a contact may record an opt-out; only an admin may lift
  // one (the server answers 403 OPTOUT_LIFT_FORBIDDEN otherwise).
  const canLiftOptOut = can("optout:lift");

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [editOptedOut, setEditOptedOut] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // fetch customer
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    apiGetCustomer(id)
      .then((res) => {
        if (cancelled) return;
        setCustomer(res.data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        if (err.message.includes("404") || err.message.toLowerCase().includes("not found")) {
          setNotFound(true);
        } else {
          setNotFound(true); // treat any fetch error as not-found on detail page
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  function startEdit() {
    if (!customer) return;
    setEditName(customer.name ?? "");
    setEditEmail(customer.email ?? "");
    setEditTags([...(customer.tags ?? [])]);
    setEditNotes(customer.notes ?? "");
    setEditOptedOut(customer.optedOut ?? false);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!customer) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiUpdateCustomer(id, {
        name: editName || undefined,
        email: editEmail || undefined,
        tags: editTags,
        notes: editNotes || undefined,
        optedOut: editOptedOut,
      });
      setCustomer(res.data);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "OPTOUT_LIFT_FORBIDDEN") {
        setEditOptedOut(true);
        setSaveError("Only an admin can lift an opt-out. The contact is still opted out — save again to keep your other changes.");
      } else {
        setSaveError(err instanceof Error ? err.message : "Failed to save changes.");
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[60vh]">
        <span className="text-[13px] text-gray-400">Loading contact…</span>
      </div>
    );
  }

  // ── Not found state ──────────────────────────────────────────────────────────
  if (notFound || !customer) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-[60vh] px-6">
        <p className="text-[15px] font-semibold text-gray-700">Contact not found</p>
        <p className="text-[13px] text-gray-400 text-center max-w-xs">
          The contact you are looking for does not exist or may have been removed.
        </p>
        <button
          type="button"
          onClick={() => router.push("/customers")}
          className="flex items-center gap-2 text-[13px] font-medium text-brand-fg hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Contacts
        </button>
      </div>
    );
  }

  const displayName = customer.name || customer.phone;

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 bg-canvas-warm min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-100 shrink-0">
        <button
          type="button"
          onClick={() => router.push("/customers")}
          className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] text-gray-900 leading-tight truncate">
            {displayName}
          </p>
          {customer.name && (
            <p className="text-[12px] text-gray-400 leading-tight">{customer.phone}</p>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/20 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="max-w-2xl mx-auto">
          {/* Customer info card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-[14px] font-semibold text-gray-800">
                Contact Info
              </h2>
              {!editing ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-brand-fg transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    {saving ? (
                      "Saving…"
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Save
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Success banner */}
            {saved && (
              <div className="mx-6 mt-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-[12px] font-medium px-4 py-2.5 rounded-xl">
                <Check className="w-3.5 h-3.5 shrink-0" />
                Changes saved successfully.
              </div>
            )}

            {/* Error banner */}
            {saveError && (
              <div className="mx-6 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-[12px] font-medium px-4 py-2.5 rounded-xl">
                <X className="w-3.5 h-3.5 shrink-0" />
                {saveError}
              </div>
            )}

            {/* Fields */}
            <div className="px-6 py-5 flex flex-col gap-5">
              {/* Name */}
              <Field label="Name">
                {editing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Enter name"
                    className="px-3 py-2 border border-gray-200 rounded-xl text-[13px] text-gray-700 placeholder:text-gray-400 outline-none focus:border-brand transition-colors bg-white"
                  />
                ) : (
                  <p className="text-[13px] text-gray-700">
                    {customer.name ?? (
                      <span className="text-gray-400 italic">Not set</span>
                    )}
                  </p>
                )}
              </Field>

              {/* Phone (always read-only) */}
              <Field label="Phone">
                <p className="text-[13px] text-gray-700 font-mono">{customer.phone}</p>
              </Field>

              {/* Email */}
              <Field label="Email">
                {editing ? (
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Enter email"
                    className="px-3 py-2 border border-gray-200 rounded-xl text-[13px] text-gray-700 placeholder:text-gray-400 outline-none focus:border-brand transition-colors bg-white"
                  />
                ) : (
                  <p className="text-[13px] text-gray-700">
                    {customer.email ?? (
                      <span className="text-gray-400 italic">Not set</span>
                    )}
                  </p>
                )}
              </Field>

              {/* Tags */}
              <Field label="Tags">
                {editing ? (
                  <TagInput tags={editTags} onChange={setEditTags} />
                ) : (
                  <TagPills tags={customer.tags ?? []} />
                )}
              </Field>

              {/* Notes */}
              <Field label="Notes">
                {editing ? (
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="Add notes about this contact…"
                    className="bidi px-3 py-2 border border-gray-200 rounded-xl text-[13px] text-gray-700 placeholder:text-gray-400 outline-none focus:border-brand transition-colors bg-white resize-y leading-relaxed"
                  />
                ) : (
                  <p className="bidi text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {customer.notes ?? (
                      <span className="text-gray-400 italic">No notes</span>
                    )}
                  </p>
                )}
              </Field>

              {/* Marketing opt-out */}
              <Field label="Marketing">
                {editing ? (
                  <button
                    type="button"
                    onClick={() => setEditOptedOut((v) => !v)}
                    // Switching it back ON (subscribed) lifts an opt-out: admins only.
                    disabled={!!customer.optedOut && !canLiftOptOut}
                    title={customer.optedOut && !canLiftOptOut ? "Only an admin can lift an opt-out" : undefined}
                    className="flex items-center gap-3 w-fit cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        editOptedOut ? "bg-red-400" : "bg-brand"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          editOptedOut ? "translate-x-[18px]" : "translate-x-1"
                        }`}
                      />
                    </span>
                    <span className="text-[13px] text-gray-700">
                      {editOptedOut ? "Opted out of campaigns" : "Subscribed to campaigns"}
                    </span>
                  </button>
                ) : customer.optedOut ? (
                  <span className="inline-flex w-fit items-center bg-red-50 text-red-600 text-[12px] font-medium px-2.5 py-1 rounded-full">
                    Opted out of campaigns
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center bg-brand/10 text-brand-fg text-[12px] font-medium px-2.5 py-1 rounded-full">
                    Subscribed
                  </span>
                )}
              </Field>

              {/* Member since */}
              <Field label="Member Since">
                <p className="text-[13px] text-gray-500">
                  {new Date(customer.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </Field>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
