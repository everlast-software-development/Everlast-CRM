"use client";

// The chat's contact panel — WhatsApp Web's "Contact info", for the CRM:
// who this is, its follow-up, what they answered
// through a flow, notes and tags the team can edit mid-conversation, the chat's
// media/docs/links, and the campaigns they received. Opened from the chat header.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  X, Search, Pencil, Check, Copy, StickyNote, Tag, Image as ImageIcon, FileText, Link2,
  Megaphone, ShieldOff, Video, Music, Loader2, ArrowLeft, ExternalLink,
  CalendarClock, Hourglass, MessageSquareText, Lock, Trash2, Eye,
} from "lucide-react";
import { SeenBy } from "@/components/SeenBy";
import {
  apiAddConversationNote, apiDeleteConversationNote, apiGetConversationProfile,
  apiSearchMessages, apiUpdateCustomer,
} from "@/lib/api";
import type { ConversationNote, Message } from "@/types";
import { getSocket } from "@/lib/socket";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { LiftOptOutDialog, RecordOptOutDialog, optOutSourceLabel, useOptOutChanged } from "@/components/OptOut";
import {
  OUTCOME_CHIP, OUTCOME_LABEL, OVERDUE_CHIP, WAIT_AMBER_MIN, WAIT_RED_MIN, type ProfileWithOutcome,
  activeOutcome, fmtElapsed, fmtWhen, isOverdue, personName,
} from "@/lib/chatOutcome";

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const initialsOf = (p: { name?: string | null; username: string } | null) =>
  personName(p).split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const NOTE_MAX = 2000;

function Section({ icon: Icon, title, aside, children }: { icon: React.ComponentType<{ className?: string }>; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4 border-b border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-gray-400" />
        <h4 className="text-[13px] font-semibold text-gray-700 flex-1">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

type MediaTab = "media" | "docs" | "links";

export function ContactPanel({
  conversationId,
  refreshKey,
  onClose,
  onJumpToMessage,
}: {
  conversationId: string;
  /** Changes when new messages arrive, so media/links stay current. */
  refreshKey: number;
  onClose: () => void;
  /** Scrolls the chat to a message; false when it isn't loaded (older). */
  onJumpToMessage: (messageId: number) => boolean;
}) {
  const { can, me } = useCurrentUser();
  const canEdit = can("contact:write");
  // Working the chat: writing notes, recording an opt-out.
  const canWork = can("conversation:write");
  // Supervisors may remove anyone's note; everyone else only their own (the server decides).
  const canSupervise = can("team:supervise");
  // Lifting a marketing opt-out is admins only; recording one is anyone working the chat.
  const canLiftOptOut = can("optout:lift");
  const toast = useToast();
  const chatId = Number(conversationId);
  const [profile, setProfile] = useState<ProfileWithOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", chartNumber: "", nationality: "" });
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirtyState] = useState(false);
  // Read by the loader so a refresh never overwrites a note being typed.
  const notesDirtyRef = useRef(false);
  const setNotesDirty = (v: boolean) => { notesDirtyRef.current = v; setNotesDirtyState(v); };
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  // Chat notes (staff-only), and the note waiting on a "really?".
  const [noteDraft, setNoteDraft] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [confirm, setConfirm] = useState<ConversationNote | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [optOutDialog, setOptOutDialog] = useState<"record" | "lift" | null>(null);

  // For "waiting 12m" and overdue follow-ups.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Search + media views
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [mediaTab, setMediaTab] = useState<MediaTab>("media");

  useEffect(() => {
    let cancelled = false;
    apiGetConversationProfile(conversationId)
      .then((res) => {
        if (cancelled) return;
        // The shared type predates outcomes and notes; see ProfileWithOutcome.
        setProfile(res.data as unknown as ProfileWithOutcome);
        setError(null);
        const c = res.data.customer;
        setForm({ name: c.name || "", email: c.email || "", chartNumber: c.chartNumber || "", nationality: c.nationality || "" });
        if (!notesDirtyRef.current) setNotes(c.notes || "");
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load contact info"); });
    return () => { cancelled = true; };
  }, [conversationId, refreshKey, reload]);

  // Follow-up / note changes — ours or a colleague's — reload the panel.
  useEffect(() => {
    const socket = getSocket();
    const onChange = (p: { conversationId?: number | string }) => {
      if (String(p?.conversationId) === conversationId) setReload((n) => n + 1);
    };
    const events = ["conversation.outcome", "conversation.note"];
    events.forEach((e) => socket.on(e, onChange));
    return () => {
      events.forEach((e) => socket.off(e, onChange));
    };
  }, [conversationId]);

  // Opt-out recorded or lifted (here, from the chat, by a colleague, or the patient's STOP).
  const reloadPanel = useCallback(() => setReload((n) => n + 1), []);
  useOptOutChanged(conversationId, profile?.customer.id ?? null, reloadPanel);

  useEffect(() => {
    if (!searching || query.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearchBusy(true);
      apiSearchMessages(query.trim(), conversationId, 1, 40)
        .then((res) => { if (!cancelled) setResults(res.data); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearchBusy(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searching, query, conversationId]);

  const save = useCallback(async (patch: Parameters<typeof apiUpdateCustomer>[1], okMessage: string) => {
    if (!profile) return false;
    setSaving(true);
    try {
      await apiUpdateCustomer(profile.customer.id, patch);
      toast.success(okMessage);
      setReload((n) => n + 1);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile, toast]);

  async function addNote() {
    const body = noteDraft.trim();
    if (!body || addingNote) return;
    setAddingNote(true);
    try {
      const res = await apiAddConversationNote(chatId, body);
      setNoteDraft("");
      setProfile((p) => (p ? { ...p, notes: [...p.notes.filter((n) => n.id !== res.data.id), res.data] } : p));
      toast.success("Note added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the note");
    } finally {
      setAddingNote(false);
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      const id = confirm.id;
      await apiDeleteConversationNote(chatId, id);
      setProfile((p) => (p ? { ...p, notes: p.notes.filter((n) => n.id !== id) } : p));
      toast.success("Note deleted");
      setConfirm(null);
      setReload((n) => n + 1);
    } catch (err) {
      // e.g. a 403 on someone else's note — the server's own words.
      toast.error(err instanceof Error ? err.message : "Couldn't do that");
    } finally {
      setConfirmBusy(false);
    }
  }

  const jump = (messageId: number) => {
    if (!onJumpToMessage(messageId)) toast.info("That message is further up — scroll up in the chat to load it.");
  };

  if (error) {
    return (
      <PanelShell onClose={onClose} title="Contact info">
        <p className="p-5 text-[13px] text-red-600">{error}</p>
      </PanelShell>
    );
  }
  if (!profile) {
    return (
      <PanelShell onClose={onClose} title="Contact info">
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 text-gray-300 animate-spin" /></div>
      </PanelShell>
    );
  }

  const c = profile.customer;
  const initials = (c.name || c.phone).split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  // ── Search view (replaces the panel body, like WhatsApp Web) ─────────────
  if (searching) {
    return (
      <PanelShell
        onClose={onClose}
        title="Search messages"
        back={() => { setSearching(false); setQuery(""); setResults([]); }}
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this chat…" className="flex-1 bg-transparent outline-none text-[13px]" />
            {searchBusy && <Loader2 className="w-3.5 h-3.5 text-gray-300 animate-spin" />}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="p-5 text-[12px] text-gray-400">Type at least 2 characters.</p>
          ) : results.length === 0 && !searchBusy ? (
            <p className="p-5 text-[12px] text-gray-400">No messages found.</p>
          ) : (
            results.map((m) => (
              <button key={String(m.id ?? m._id)} type="button" onClick={() => jump(Number(m.id ?? m._id))} className="w-full text-left px-5 py-3 border-b border-gray-50 hover:bg-gray-50">
                <p className="text-[11px] text-gray-400">{fmtDateTime(m.createdAt)} · {m.senderType === "CUSTOMER" ? c.name || "Customer" : m.senderType === "BOT" ? "Automation" : "Team"}</p>
                <p className="text-[13px] text-gray-700 line-clamp-2">{snippet(m.content)}</p>
              </button>
            ))
          )}
        </div>
      </PanelShell>
    );
  }

  const imagesAndVideos = profile.media.filter((m) => m.messageType === "IMAGE" || m.messageType === "VIDEO");
  const docs = profile.media.filter((m) => m.messageType === "DOCUMENT" || m.messageType === "AUDIO");
  const conv = profile.conversation;
  // Only a follow-up shows; a legacy outcome (Booked / Not interested / No answer) reads as none.
  const outcome = activeOutcome(conv.outcome);
  const outcomeOverdue = outcome === "FOLLOW_UP" && isOverdue(conv.followUpAt, now);
  const waitingMin = conv.awaitingReplySince && conv.status !== "RESOLVED" ? (now - new Date(conv.awaitingReplySince).getTime()) / 60_000 : null;
  // Newest first — the latest word on this chat is what a colleague needs.
  const chatNotes = [...(profile.notes || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const mediaTotal = (profile.mediaCounts.IMAGE || 0) + (profile.mediaCounts.VIDEO || 0) + (profile.mediaCounts.DOCUMENT || 0) + (profile.mediaCounts.AUDIO || 0) + profile.links.length;

  return (
    <PanelShell onClose={onClose} title="Contact info">
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-brand/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Identity */}
        <div className="px-5 pt-6 pb-5 flex flex-col items-center text-center border-b border-gray-100">
          <div className="w-24 h-24 rounded-full bg-brand-100 text-brand-fg flex items-center justify-center text-[28px] font-bold">{initials}</div>
          {editing ? (
            <div className="w-full mt-4 space-y-2 text-left">
              {([
                ["name", "Name"], ["email", "Email"], ["chartNumber", "Chart number"], ["nationality", "Nationality"],
              ] as const).map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[11px] font-semibold text-gray-400">{label}</span>
                  <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-brand" />
                </label>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditing(false)} className="text-[12px] text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">Cancel</button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const ok = await save({
                      name: form.name.trim(), email: form.email.trim(),
                      chartNumber: form.chartNumber.trim() || null, nationality: form.nationality.trim() || null,
                    }, "Contact updated");
                    if (ok) setEditing(false);
                  }}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3 py-1.5 rounded-lg disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-1.5">
                <h3 className="text-[18px] font-bold text-gray-900">{c.name || "No name"}</h3>
                {canEdit && (
                  <button type="button" onClick={() => setEditing(true)} title="Edit contact" className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(`+${c.phone}`).then(() => toast.success("Number copied")).catch(() => {}); }}
                className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800"
                title="Copy number"
              >
                +{c.phone} <Copy className="w-3 h-3" />
              </button>
              <p className="text-[11px] text-gray-400 mt-1">
                {profile.conversation.messageCount} messages · contact since {fmtDate(c.createdAt)}
                {profile.conversation.assignedAgent ? ` · with ${profile.conversation.assignedAgent.name || profile.conversation.assignedAgent.username}` : ""}
              </p>
              {(profile.optOut || c.optedOut) && (
                <span
                  title={
                    c.optedOut
                      ? "Do not contact: opted out of marketing on all lines"
                      : `Opted out of marketing on this line (${optOutSourceLabel(profile.optOut?.source)})`
                  }
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5"
                >
                  <ShieldOff className="w-3 h-3" />
                  {c.optedOut ? "Do not contact · all lines" : "Opted out · this line"}
                  {profile.optOut ? ` · ${fmtDate(profile.optOut.optedOutAt)}` : ""}
                </span>
              )}
              {((canWork && !c.optedOut) || (canLiftOptOut && (profile.optOut || c.optedOut))) && (
                <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                  {canWork && !c.optedOut && (
                    <button type="button" onClick={() => setOptOutDialog("record")} className="font-semibold text-red-600 hover:underline underline-offset-2 cursor-pointer">
                      Opt out of marketing…
                    </button>
                  )}
                  {canLiftOptOut && (profile.optOut || c.optedOut) && (
                    <button type="button" onClick={() => setOptOutDialog("lift")} className="font-semibold text-gray-500 hover:text-gray-800 hover:underline underline-offset-2 cursor-pointer">
                      Lift opt-out…
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {!editing && (
            <div className="mt-4 flex gap-3">
              <PanelAction icon={Search} label="Search" onClick={() => setSearching(true)} />
              <PanelAction icon={ExternalLink} label="Contact" href={`/customers?search=${encodeURIComponent(c.phone)}`} />
            </div>
          )}

          {!editing && (c.email || c.chartNumber || c.nationality || c.gender || c.dateOfBirth) && (
            <dl className="mt-4 w-full grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-[12px]">
              {c.chartNumber && (<><dt className="text-gray-400">Chart #</dt><dd className="text-gray-700">{c.chartNumber}</dd></>)}
              {c.email && (<><dt className="text-gray-400">Email</dt><dd className="text-gray-700 truncate">{c.email}</dd></>)}
              {c.nationality && (<><dt className="text-gray-400">Nationality</dt><dd className="text-gray-700">{c.nationality}</dd></>)}
              {c.gender && (<><dt className="text-gray-400">Gender</dt><dd className="text-gray-700">{c.gender === "MALE" ? "Male" : "Female"}</dd></>)}
              {c.dateOfBirth && (<><dt className="text-gray-400">Born</dt><dd className="text-gray-700">{fmtDate(c.dateOfBirth)}</dd></>)}
            </dl>
          )}
        </div>

        {/* Follow-up — when to get back to this patient, and who set it */}
        <Section icon={CalendarClock} title="Follow-up">
          {outcome ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full border ${outcomeOverdue ? OVERDUE_CHIP : OUTCOME_CHIP[outcome]}`}>
                  {outcomeOverdue ? "Follow up overdue" : OUTCOME_LABEL[outcome]}
                </span>
                {outcome === "FOLLOW_UP" && conv.followUpAt && (
                  <span className={`text-[12px] ${outcomeOverdue ? "text-red-600 font-semibold" : "text-gray-700"}`}>
                    {outcomeOverdue ? "was due" : "due"} {fmtWhen(conv.followUpAt)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                Set by {personName(conv.outcomeBy)}{conv.outcomeAt ? ` · ${fmtDateTime(conv.outcomeAt)}` : ""}
              </p>
            </>
          ) : (
            <Empty text={canWork ? "No follow-up set. Set one from the Follow up chip in the chat header." : "No follow-up set."} />
          )}
          {waitingMin !== null && (
            <p className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold ${waitingMin >= WAIT_RED_MIN ? "text-red-600" : waitingMin >= WAIT_AMBER_MIN ? "text-amber-700" : "text-gray-500"}`}>
              <Hourglass className="w-3 h-3" /> Waiting for a reply · {fmtElapsed(waitingMin * 60_000)}
            </p>
          )}
        </Section>

        {/* Patient notes — on the contact record, so every chat with them shows them */}
        <Section icon={StickyNote} title="Patient notes">
          <textarea
            value={notes}
            disabled={!canEdit}
            onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
            rows={3}
            placeholder={canEdit ? "Add a note for the team — e.g. prefers evenings, allergic to…" : "No notes"}
            className="bidi w-full resize-y border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-brand disabled:bg-gray-50"
          />
          {notesDirty && (
            <div className="flex justify-end gap-2 mt-1.5">
              <button type="button" onClick={() => { setNotes(c.notes || ""); setNotesDirty(false); }} className="text-[12px] text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-50">Discard</button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => { if (await save({ notes }, "Note saved")) setNotesDirty(false); }}
                className="text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3 py-1 rounded-lg disabled:opacity-60"
              >
                Save note
              </button>
            </div>
          )}
        </Section>

        {/* Chat notes — a staff-only timeline for this chat */}
        <Section icon={MessageSquareText} title="Chat notes" aside={chatNotes.length ? <span className="text-[11px] text-gray-400">{chatNotes.length}</span> : undefined}>
          <p className="-mt-1.5 mb-3 flex items-center gap-1 text-[11px] text-gray-400">
            <Lock className="w-3 h-3" /> Only your team sees these — never sent to the patient.
          </p>
          {canWork && (
            <form className="mb-3" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); } }}
                rows={2}
                maxLength={NOTE_MAX}
                placeholder="Add a note for the team — e.g. called back, will confirm Thursday…"
                className="bidi w-full resize-y border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-brand"
              />
              <div className="flex items-center justify-end gap-2 mt-1.5">
                {noteDraft.length > NOTE_MAX - 200 && (
                  <span className="text-[11px] text-gray-400 tabular-nums">{noteDraft.length}/{NOTE_MAX}</span>
                )}
                <button
                  type="submit"
                  disabled={!noteDraft.trim() || addingNote}
                  className="text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5840] px-3 py-1 rounded-lg disabled:opacity-40"
                >
                  {addingNote ? "Adding…" : "Add note"}
                </button>
              </div>
            </form>
          )}
          {chatNotes.length === 0 ? (
            <Empty text="No notes on this chat yet." />
          ) : (
            <ul className="space-y-3">
              {chatNotes.map((n) => {
                const mine = !!me && n.author?.id === me.id;
                return (
                  <li key={n.id} className="group flex gap-2.5">
                    <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${mine ? "bg-brand text-white" : "bg-gray-100 text-gray-500"}`}>
                      {initialsOf(n.author)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-400">
                        <span className="font-semibold text-gray-700">{mine ? "You" : personName(n.author)}</span> · {fmtDateTime(n.createdAt)}
                      </p>
                      <p className="bidi text-[13px] text-gray-700 whitespace-pre-wrap break-words">{n.body}</p>
                    </div>
                    {(mine || canSupervise) && (
                      <button
                        type="button"
                        title="Delete note"
                        onClick={() => setConfirm(n)}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 shrink-0 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Tags */}
        <Section icon={Tag} title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {c.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-[12px] bg-gray-100 text-gray-700 rounded-full pl-2.5 pr-1 py-0.5">
                {t}
                {canEdit && (
                  <button type="button" title="Remove tag" onClick={() => save({ tags: c.tags.filter((x) => x !== t) }, "Tag removed")} className="w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-700">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
            {c.tags.length === 0 && <span className="text-[12px] text-gray-400">No tags</span>}
          </div>
          {canEdit && (
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                const t = newTag.trim();
                if (!t || c.tags.includes(t)) return setNewTag("");
                if (await save({ tags: [...c.tags, t] }, "Tag added")) setNewTag("");
              }}
            >
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag…" className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-brand" />
              <button type="submit" disabled={!newTag.trim() || saving} className="text-[12px] font-semibold text-brand-fg border border-brand/30 bg-brand-100 px-3 rounded-lg disabled:opacity-40">Add</button>
            </form>
          )}
        </Section>

        {/* Media, links and docs */}
        <Section icon={ImageIcon} title="Media, links and docs" aside={<span className="text-[11px] text-gray-400">{mediaTotal}</span>}>
          <div className="flex gap-1 mb-3">
            {([["media", `Media (${imagesAndVideos.length})`], ["docs", `Docs (${docs.length})`], ["links", `Links (${profile.links.length})`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMediaTab(k)} className={`text-[12px] px-2.5 py-1 rounded-full border ${mediaTab === k ? "bg-brand-200 border-brand text-brand-fg font-semibold" : "border-gray-200 text-gray-500"}`}>
                {label}
              </button>
            ))}
          </div>
          {mediaTab === "media" && (imagesAndVideos.length === 0 ? <Empty text="No photos or videos in this chat." /> : (
            <div className="grid grid-cols-3 gap-1.5">
              {imagesAndVideos.map((m) => (
                <button key={m.id} type="button" onClick={() => jump(m.id)} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-90" title={fmtDateTime(m.createdAt)}>
                  {m.messageType === "IMAGE" && m.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-gray-400">{m.messageType === "VIDEO" ? <Video className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {mediaTab === "docs" && (docs.length === 0 ? <Empty text="No documents or voice notes." /> : (
            <ul className="space-y-1">
              {docs.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => jump(m.id)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 text-left">
                    {m.messageType === "AUDIO" ? <Music className="w-4 h-4 text-gray-400 shrink-0" /> : <FileText className="w-4 h-4 text-gray-400 shrink-0" />}
                    <span className="flex-1 min-w-0 text-[12px] text-gray-700 truncate">{m.messageType === "AUDIO" ? "Voice note" : (m.mediaUrl || m.content || "Document").split("/").pop()}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{fmtDate(m.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
          {mediaTab === "links" && (profile.links.length === 0 ? <Empty text="No links shared." /> : (
            <ul className="space-y-1">
              {profile.links.map((l) => (
                <li key={l.url} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-[12px] text-brand-fg hover:underline truncate">{l.url.replace(/^https?:\/\//, "")}</a>
                  <button type="button" onClick={() => jump(l.messageId)} title="Show in chat" className="text-[11px] text-gray-400 hover:text-gray-700 shrink-0">{fmtDate(l.createdAt)}</button>
                </li>
              ))}
            </ul>
          ))}
        </Section>

        {/* Campaigns */}
        <Section icon={Megaphone} title="Campaigns received" aside={profile.campaigns.length ? <span className="text-[11px] text-gray-400">{profile.campaigns.length}</span> : undefined}>
          {profile.campaigns.length === 0 ? <Empty text="No campaigns sent to this contact on this number." /> : (
            <ul className="space-y-1.5">
              {profile.campaigns.map((cp, i) => (
                <li key={`${cp.id}-${i}`}>
                  <Link href={`/campaigns/${cp.id}`} className="flex items-center gap-2 text-[12px] hover:bg-gray-50 rounded-lg px-1.5 py-1">
                    <span className="flex-1 min-w-0 truncate text-gray-700">{cp.name}</span>
                    {cp.repliedAt && <span className="text-[10px] font-semibold text-brand-fg bg-brand-100 rounded-full px-1.5">Replied</span>}
                    <span className="text-[11px] text-gray-400 shrink-0">{fmtDate(cp.sentAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Supervisors and admins: who opened this chat while it was a colleague's. */}
        <SeenBy
          conversationId={conversationId}
          render={(list, count) => (
            <Section icon={Eye} title="Seen by" aside={count ? <span className="text-[11px] text-gray-400">{count}</span> : undefined}>
              {list}
            </Section>
          )}
        />
      </div>

      {optOutDialog === "record" && (
        <RecordOptOutDialog
          conversationId={conversationId}
          state={{ line: profile.optOut, all: !!c.optedOut }}
          onClose={() => setOptOutDialog(null)}
        />
      )}
      {optOutDialog === "lift" && (profile.optOut || c.optedOut) && (
        <LiftOptOutDialog
          conversationId={conversationId}
          state={{ line: profile.optOut, all: !!c.optedOut }}
          onClose={() => setOptOutDialog(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="Delete this note?"
          body="It's removed for the whole team. This can't be undone."
          confirmLabel="Delete"
          busy={confirmBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={confirmAction}
        />
      )}
    </PanelShell>
  );
}

function ConfirmDialog({ title, body, confirmLabel, busy, onCancel, onConfirm }: {
  title: string; body: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4">
      <div role="alertdialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-[380px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">{title}</h3>
        <p className="text-[13px] text-gray-500 mb-5">{body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50">
            Keep it
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function snippet(content: string): string {
  try {
    const p = JSON.parse(content);
    if (p && typeof p.body === "string") return p.body;
  } catch {
    // plain text
  }
  return content;
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12px] text-gray-400">{text}</p>;
}

function PanelAction({ icon: Icon, label, onClick, href }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="w-11 h-11 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-brand-fg group-hover:bg-brand-100">
        <Icon className="w-4.5 h-4.5" />
      </span>
      <span className="text-[11px] text-gray-600">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="group flex flex-col items-center gap-1">{inner}</Link>
  ) : (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-1">{inner}</button>
  );
}

function PanelShell({ title, onClose, back, children }: { title: string; onClose: () => void; back?: () => void; children: React.ReactNode }) {
  return (
    <aside className="w-full md:w-[360px] lg:w-[380px] shrink-0 h-full flex flex-col bg-white border-l border-gray-100 relative z-10">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
        <button type="button" onClick={back ?? onClose} title={back ? "Back" : "Close"} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100">
          {back ? <ArrowLeft className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
        <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </aside>
  );
}
