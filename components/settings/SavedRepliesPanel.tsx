"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { apiCreateSavedReply, apiDeleteSavedReply, apiGetSavedReplies, apiUpdateSavedReply } from "@/lib/api";
import type { SavedReply } from "@/types";
import { useToast } from "@/components/ui/toast";
import { PageSpinner } from "@/components/ui/spinner";
import { DialogButtons, DialogShell } from "@/components/DialogShell";
import { LoadError, SectionCard, errorMessage, inputCls, labelCls, primaryBtnCls } from "@/components/settings/shared";

// The shared canned answers agents insert by typing "/" in a chat. Admins and
// supervisors (saved_reply:write) keep the list; limits match the API's.
const SHORTCUT_MAX = 30;
const TITLE_MAX = 80;
const BODY_MAX = 4096;

// Lowercase as you type and spaces become "-", so the server's
// "lowercase letters, numbers, - or _" rule rarely has to refuse anything.
const toShortcut = (v: string) => v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, SHORTCUT_MAX);

export function SavedRepliesPanel() {
  const toast = useToast();
  const [replies, setReplies] = useState<SavedReply[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // null = closed; "new" = adding; a reply = editing it.
  const [editing, setEditing] = useState<SavedReply | "new" | null>(null);
  const [deleting, setDeleting] = useState<SavedReply | null>(null);

  const load = useCallback(() => {
    return apiGetSavedReplies()
      .then((res) => { setReplies(res.data); setLoadError(null); })
      .catch((err) => setLoadError(errorMessage(err, "Couldn't load saved replies.")));
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!replies || !q) return replies ?? [];
    return replies.filter((r) => r.shortcut.includes(q) || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q));
  }, [replies, query]);

  if (loadError) return <LoadError message={loadError} onRetry={load} />;
  if (!replies) return <PageSpinner />;

  return (
    <SectionCard
      title="Saved replies"
      description={<>Agents type <b>/</b> in a chat to insert one, then edit it before sending. Write <b>{"{name}"}</b> for the patient&apos;s first name.</>}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved replies"
            className="w-full text-[13px] border border-gray-200 rounded-xl pl-9 pr-3 py-2 outline-none focus:border-brand bg-white"
          />
        </div>
        <button type="button" onClick={() => setEditing("new")} className={primaryBtnCls}>
          <Plus className="w-4 h-4" /> Add reply
        </button>
      </div>

      {replies.length === 0 ? (
        <div className="text-center py-10">
          <MessageSquareText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-[13px] font-medium text-gray-600">No saved replies yet</p>
          <p className="text-[12px] text-gray-400 mt-0.5">Add answers the team gives often: opening hours, address, prices.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-gray-400 py-6 text-center">No saved replies match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="divide-y divide-gray-100 -mx-5">
          {shown.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-start gap-3">
              <span className="shrink-0 mt-0.5 text-[12px] font-mono font-semibold text-brand-fg bg-brand-100 rounded-md px-1.5 py-0.5">/{r.shortcut}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-gray-800 truncate" dir="auto">{r.title}</p>
                <p className="text-[12.5px] text-gray-500 line-clamp-2 whitespace-pre-wrap break-words" dir="auto">{r.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setEditing(r)} aria-label={`Edit /${r.shortcut}`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 cursor-pointer">
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setDeleting(r)} aria-label={`Delete /${r.shortcut}`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ReplyDialog
          reply={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setReplies((list) => {
              const rest = (list ?? []).filter((r) => r.id !== saved.id);
              return [...rest, saved].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
            });
            setEditing(null);
            toast.success(isNew ? "Saved reply added" : "Saved reply updated");
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          reply={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setReplies((list) => (list ?? []).filter((r) => r.id !== deleting.id));
            setDeleting(null);
            toast.success("Saved reply deleted");
          }}
        />
      )}
    </SectionCard>
  );
}

function ReplyDialog({ reply, onCancel, onSaved }: {
  reply: SavedReply | null;
  onCancel: () => void;
  onSaved: (reply: SavedReply, isNew: boolean) => void;
}) {
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "");
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = shortcut.trim() && title.trim() && body.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = { shortcut: shortcut.trim(), title: title.trim(), body: body.trim() };
      const res = reply ? await apiUpdateSavedReply(reply.id, data) : await apiCreateSavedReply(data);
      onSaved(res.data, !reply);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the reply."));
      setSaving(false);
    }
  }

  return (
    <DialogShell title={reply ? "Edit saved reply" : "Add saved reply"} onCancel={onCancel} saving={saving} width="w-[520px]">
      <form onSubmit={submit} className="px-6 pb-6 space-y-4">
        <div>
          <label htmlFor="sr-shortcut" className={labelCls}>Shortcut</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-gray-400">/</span>
            <input
              id="sr-shortcut"
              autoFocus
              value={shortcut}
              onChange={(e) => setShortcut(toShortcut(e.target.value))}
              placeholder="hours"
              className={`${inputCls} pl-7 font-mono`}
            />
          </div>
          <p className="text-[11.5px] text-gray-400 mt-1">What agents type after /. Lowercase, no spaces.</p>
        </div>
        <div>
          <label htmlFor="sr-title" className={labelCls}>Title</label>
          <input id="sr-title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Opening hours" dir="auto" className={inputCls} />
        </div>
        <div>
          <label htmlFor="sr-body" className={labelCls}>Text</label>
          <textarea
            id="sr-body"
            value={body}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            dir="auto"
            placeholder={"Hi {name}, we're open every day from 9 am to 9 pm."}
            className={`${inputCls} resize-y`}
          />
          <p className="text-[11.5px] text-gray-400 mt-1">{"{name}"} becomes the patient&apos;s first name, or is left out if we don&apos;t have one.</p>
        </div>
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onCancel} label={reply ? "Save" : "Add reply"} disabled={!ready} />
      </form>
    </DialogShell>
  );
}

function DeleteDialog({ reply, onCancel, onDeleted }: { reply: SavedReply; onCancel: () => void; onDeleted: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiDeleteSavedReply(reply.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the reply."));
      setSaving(false);
    }
  }

  return (
    <DialogShell
      title="Delete saved reply?"
      intro={<>Agents will no longer find <b>/{reply.shortcut}</b>. Messages already sent aren&apos;t affected.</>}
      onCancel={onCancel}
      saving={saving}
    >
      <form onSubmit={submit} className="px-6 pb-6 space-y-3">
        {error && <p role="alert" className="text-[13px] text-red-500 font-medium">{error}</p>}
        <DialogButtons saving={saving} onCancel={onCancel} label="Delete" danger />
      </form>
    </DialogShell>
  );
}
