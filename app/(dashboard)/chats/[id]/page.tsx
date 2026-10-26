"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useState, useEffect, useLayoutEffect, useRef, startTransition, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Paperclip,
  Send,
  Smile,
  Download,
  ExternalLink,
  FileText,
  X,
  LayoutTemplate,
  Clock,
  CornerUpLeft,
  List as ListIcon,
  Phone,
  ChevronDown,
  Trash2,
  Loader2,
  PanelRight,
  ShieldOff,
} from "lucide-react";
import {
  useMessages,
  emitTypingStart,
  emitTypingStop,
} from "@/hooks/useMessages";
import { useConversationsContext } from "@/components/ConversationsContext";
import {
  apiSendMessage,
  apiUploadMedia,
  apiGetUser,
  apiGetTemplates,
  apiSendTemplate,
  apiDeleteMessage,
  apiFetchMediaBlob,
  apiSendTyping,
  ApiError,
} from "@/lib/api";
import { ContactPanel } from "@/components/ContactPanel";
import { MessageMenu } from "@/components/MessageMenu";
import { WaText } from "@/components/templates/shared";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/ThemeProvider";
import { Spinner } from "@/components/ui/spinner";
import type { Message, QuotedMessage, Template } from "@/types";
import {
  MediaPlayer,
  MediaPlayerAudio,
  MediaPlayerVideo,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerPlay,
  MediaPlayerSeek,
  MediaPlayerTime,
  MediaPlayerVolume,
  MediaPlayerFullscreen,
  MediaPlayerLoading,
  MediaPlayerDownload,
  useMediaPlayer,
} from "@/components/ui/media-player";
import {
  useMediaDispatch,
  MediaActionTypes,
} from "media-chrome/react/media-store";
import { isWindowClosed } from "@/lib/messagingWindow";
import { AssigneePicker } from "@/components/AssigneePicker";
import { ConversationOutcomeControl } from "@/components/ConversationOutcomeControl";
import { OptOutBanner, isMarketingTemplate, isOptedOut, useOptOutState, type OptOutState } from "@/components/OptOut";
import type { InboxConversation } from "@/lib/chatOutcome";

/** The server refused a send because the 24-hour window is closed. */
function isWindowClosedError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "WINDOW_CLOSED";
}

/**
 * "↩ Reply to <campaign>" above a patient message the server attributed to a
 * campaign. Links to the campaign for those who can read campaigns.
 */
function CampaignReplyTag({ campaign, linkable }: { campaign: { id: number; name: string }; linkable: boolean }) {
  const cls = "inline-flex items-center gap-1 mb-1 text-[11px] font-medium text-brand-fg bg-brand-200 px-2 py-0.5 rounded-full max-w-full";
  const body = (
    <>
      <CornerUpLeft className="w-3 h-3 shrink-0" />
      <span className="truncate">Reply to &ldquo;{campaign.name}&rdquo;</span>
    </>
  );
  return linkable ? (
    <Link href={`/campaigns/${campaign.id}`} className={`${cls} hover:bg-[#c9ead4]`} title="Open the campaign">{body}</Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/**
 * One button under a template, card or flow message, drawn as WhatsApp does:
 * a full-width row with a reply, link or phone icon. Not clickable for quick
 * replies — they are the patient's to tap.
 */
function WaButton({ type, title, url, phoneNumber }: { type?: string; title: string; url?: string; phoneNumber?: string }) {
  const cls = "flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-semibold text-brand-fg";
  if (type === "URL" && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`${cls} hover:bg-black/5 dark:hover:bg-white/5`}>
        <ExternalLink className="w-3.5 h-3.5 shrink-0" /> <WaText text={title} />
      </a>
    );
  }
  if (type === "PHONE_NUMBER" && phoneNumber) {
    return (
      <a href={`tel:${phoneNumber}`} className={`${cls} hover:bg-black/5 dark:hover:bg-white/5`}>
        <Phone className="w-3.5 h-3.5 shrink-0" /> <WaText text={title} />
      </a>
    );
  }
  return (
    <div className={cls}>
      <CornerUpLeft className="w-3.5 h-3.5 shrink-0" /> <WaText text={title} />
    </div>
  );
}

const EmojiPicker = lazy(() =>
  import("@emoji-mart/react").then((m) => ({ default: m.default }))
);

// One-line preview of a message for quote blocks and the reply bar. A template's
// content is stored as JSON, so show its body text rather than "[template]" —
// replies to a campaign quote the template, and that is the message a reader
// most needs to recognise.
function messagePreview(m: { messageType: string; content: string }): string {
  if (m.messageType === "TEXT") return m.content;
  if (m.messageType === "TEMPLATE" || m.messageType === "INTERACTIVE") {
    const tpl = parseTemplateContent(m.content);
    if (tpl?.body) return tpl.body;
  }
  return `[${m.messageType.toLowerCase()}]`;
}

function parseTemplateContent(content: string): {
  headerType?: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  header?: string;
  headerMediaUrl?: string;
  body: string;
  footer?: string;
  buttons?: { id: string; type?: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; title: string; url?: string; phoneNumber?: string }[];
  // A list message sent by a flow: the menu button and its options.
  list?: { buttonLabel: string; rows: { title: string; description?: string }[] };
  // A carousel template: swipeable cards under the body.
  cards?: { mediaType: "IMAGE" | "VIDEO"; mediaUrl: string; body: string; buttons: { id: string; type: "QUICK_REPLY" | "URL"; title: string; url?: string }[] }[];
} | null {
  try {
    const p = JSON.parse(content);
    if (p && typeof p === "object" && typeof p.body === "string") return p;
  } catch {}
  return null;
}

// Day separator label: Today / Yesterday / Mon 6 Oct (/ 2025 when not this year).
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

// Consecutive messages from the same sender, same day, within 5 minutes read
// as one group: tighter spacing, one name label, one avatar.
const GROUP_GAP_MS = 5 * 60 * 1000;
function sameGroup(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b) return false;
  if (a.senderType !== b.senderType || String(a.senderId ?? "") !== String(b.senderId ?? "")) return false;
  const ta = new Date(a.createdAt), tb = new Date(b.createdAt);
  return ta.toDateString() === tb.toDateString() && Math.abs(tb.getTime() - ta.getTime()) < GROUP_GAP_MS;
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SendingDots() {
  return (
    <span className="flex gap-[3px] items-center h-4 px-1">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
    </span>
  );
}

function MessageStatus({
  isSending,
  status,
}: {
  isSending: boolean;
  status: Message["status"];
}) {
  if (isSending) return <SendingDots />;
  if (status === null) return <SendingDots />;
  if (status === "PENDING")
    return <span className="text-[11px] text-gray-300" title="Sending">✓</span>;
  if (status === "SENT")
    return <span className="text-[11px] text-gray-500" title="Sent">✓</span>;
  if (status === "DELIVERED")
    return <span className="text-[11px] text-gray-500" title="Delivered">✓✓</span>;
  if (status === "READ")
    return <span className="text-[11px] text-[#2B9FD9]" title="Read">✓✓</span>;
  if (status === "FAILED")
    return <span className="text-[11px] font-bold text-red-500" title="Not delivered">!</span>;
  return <span className="text-[11px] text-gray-500">✓</span>;
}

const AGENT_COLORS = [
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#0EA5E9",
  "#10B981",
];

function agentColor(sid: string): string {
  const n = parseInt(sid, 10) || 0;
  return AGENT_COLORS[n % AGENT_COLORS.length];
}

function getAgentAvatar(
  senderId: string | number | null,
  currentUser: { id: string | number; username: string } | null,
  assignedAgent: { id: number; username: string } | null,
  cache: Record<string, string>,
): { initials: string; color: string; name: string } {
  const inits = (name: string) =>
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "A";

  // Optimistic (senderId not yet set) — attribute to current user
  if (senderId == null) {
    if (currentUser)
      return {
        initials: inits(currentUser.username),
        color: "#3B694C",
        name: currentUser.username,
      };
    return { initials: "A", color: "#3B694C", name: "You" };
  }

  const sid = String(senderId);

  if (currentUser && String(currentUser.id) === sid)
    return {
      initials: inits(currentUser.username),
      color: "#3B694C",
      name: currentUser.username,
    };

  if (assignedAgent && String(assignedAgent.id) === sid)
    return {
      initials: inits(assignedAgent.username),
      color: agentColor(sid),
      name: assignedAgent.username,
    };

  if (cache[sid])
    return {
      initials: inits(cache[sid]),
      color: agentColor(sid),
      name: cache[sid],
    };

  return { initials: "A", color: agentColor(sid), name: `Agent ${sid}` };
}


/* ── media src hook ──
   directSrc: Cloudinary URL → use immediately (agent-sent, or customer after media_ready)
   mediaMsgId: message id   → fetched via apiFetchMediaBlob (customer fallback) */
function useMediaSrc(directSrc: string | null, mediaMsgId: number | null) {
  const [src, setSrc] = useState<string | null>(directSrc);
  const [loading, setLoading] = useState(!directSrc);

  // When directSrc arrives late (media_ready socket event), update src immediately
  useEffect(() => {
    if (!directSrc) return;
    setSrc(directSrc);
    setLoading(false);
  }, [directSrc]);

  useEffect(() => {
    if (directSrc || !mediaMsgId) return;
    let objectUrl: string | null = null;
    // Goes through lib/api.ts rather than a bare fetch: media is number-scoped
    // server-side, so without the X-WhatsApp-Number-Id header this 404s.
    apiFetchMediaBlob(mediaMsgId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [directSrc, mediaMsgId]);

  return { src, loading };
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Image"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg select-none cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

function ImageMessage({ directSrc, mediaMsgId }: { directSrc: string | null; mediaMsgId: number | null }) {
  const { src, loading } = useMediaSrc(directSrc, mediaMsgId);
  const [open, setOpen] = useState(false);

  if (loading) return <div className="w-[220px] h-[160px] bg-gray-200/60 animate-pulse rounded-xl" />;
  if (!src) return <span className="text-[12px] text-gray-400">Failed to load image</span>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Image"
        className="max-w-full max-h-[260px] w-auto h-auto rounded-xl block cursor-pointer"
        onClick={() => setOpen(true)}
      />
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];

function SpeedCycleButton() {
  const dispatch = useMediaDispatch();
  const rate = useMediaPlayer((state) => (state as { mediaPlaybackRate?: number }).mediaPlaybackRate ?? 1);
  function cycle() {
    const idx = SPEEDS.indexOf(rate);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    dispatch({ type: MediaActionTypes.MEDIA_PLAYBACK_RATE_REQUEST, detail: next });
  }
  return (
    <button
      type="button"
      onClick={cycle}
      className="text-[11px] font-bold w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent text-primary transition-colors shrink-0 tabular-nums cursor-pointer"
    >
      {rate === 1 ? "1×" : `${rate}×`}
    </button>
  );
}

function AudioMessage({ directSrc, mediaMsgId }: { directSrc: string | null; mediaMsgId: number | null }) {
  const { src, loading } = useMediaSrc(directSrc, mediaMsgId);
  if (loading) return <div className="w-[260px] h-12 bg-gray-200/60 animate-pulse rounded-lg" />;
  if (!src) return <span className="text-[12px] text-gray-400">Failed to load audio</span>;
  return (
    <MediaPlayer
      autoHide={false}
      className="w-[400px] h-auto rounded-xl"
      style={{
        "--background":          "0 0% 100%",
        "--foreground":          "142 28% 25%",
        "--primary":             "142 28% 32%",
        "--primary-foreground":  "0 0% 100%",
        "--accent":              "142 30% 92%",
        "--accent-foreground":   "142 28% 25%",
        "--muted":               "142 30% 92%",
        "--muted-foreground":    "142 20% 45%",
        "--border":              "142 20% 85%",
        "--ring":                "142 28% 32%",
        "--popover":             "0 0% 100%",
        "--popover-foreground":  "142 28% 25%",
      } as React.CSSProperties}
    >
      <MediaPlayerAudio src={src} />
      <div className="flex items-center gap-2 px-3 py-3">
        <MediaPlayerPlay className="size-9 shrink-0 cursor-pointer" />
        <MediaPlayerSeek className="flex-1" />
        <MediaPlayerTime className="text-[12px] tabular-nums" />
        <MediaPlayerVolume expandable />
        <SpeedCycleButton />
      </div>
    </MediaPlayer>
  );
}

function VideoMessage({ src }: { src: string | null }) {
  if (!src) {
    return (
      <div className="w-[260px] h-[148px] bg-gray-900 dark:bg-black rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400">
        <svg className="w-8 h-8 opacity-40" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
        <span className="text-[12px]">Video processing…</span>
      </div>
    );
  }
  return (
    <MediaPlayer className="video-player w-[400px] aspect-video rounded-xl overflow-hidden">
      <MediaPlayerVideo src={src} className="size-full object-contain" />
      <MediaPlayerControlsOverlay />
      <MediaPlayerControls>
        <MediaPlayerPlay className="size-9 shrink-0" />
        <MediaPlayerVolume expandable />
        <MediaPlayerSeek className="flex-1" />
        <MediaPlayerTime className="text-[12px] tabular-nums" />
        <MediaPlayerDownload className="size-8 shrink-0" />
        <MediaPlayerFullscreen className="size-9 shrink-0" />
      </MediaPlayerControls>
      <MediaPlayerLoading />
    </MediaPlayer>
  );
}

// What a document is, read from its stored URL's extension (storage keys always
// end in one), so the bubble says "PDF document" before anyone opens it.
// `viewable` = the browser shows it in a tab; anything else just downloads.
const FILE_KINDS: Record<string, { label: string; badge: string; viewable?: boolean }> = {
  pdf:  { label: "PDF document",      badge: "bg-red-600", viewable: true },
  doc:  { label: "Word document",     badge: "bg-blue-600" },
  docx: { label: "Word document",     badge: "bg-blue-600" },
  xls:  { label: "Excel spreadsheet", badge: "bg-emerald-600" },
  xlsx: { label: "Excel spreadsheet", badge: "bg-emerald-600" },
  csv:  { label: "CSV spreadsheet",   badge: "bg-emerald-600" },
  ppt:  { label: "PowerPoint",        badge: "bg-orange-600" },
  pptx: { label: "PowerPoint",        badge: "bg-orange-600" },
  txt:  { label: "Text file",         badge: "bg-gray-500", viewable: true },
  zip:  { label: "ZIP archive",       badge: "bg-amber-600" },
};

function fileExtension(url: string | null): string | null {
  if (!url) return null;
  try {
    const name = new URL(url).pathname.split("/").pop() ?? "";
    return /\.([a-z0-9]{1,5})$/i.exec(name)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function DocumentMessage({ directSrc, mediaMsgId }: { directSrc: string | null; mediaMsgId: number | null }) {
  const [opening, setOpening] = useState(false);
  const ext = fileExtension(directSrc);
  const kind = (ext && FILE_KINDS[ext]) || { label: "Document", badge: "bg-gray-500", viewable: false };
  const Icon = kind.viewable ? ExternalLink : Download;
  const available = Boolean(directSrc || mediaMsgId);

  // Storage is on another origin without CORS, so the browser can't force a
  // named download — open it in a new tab instead (a plain same-tab click used
  // to navigate the CRM away to the file). PDFs show the browser's viewer,
  // which has its own download button; other types download straight away.
  // Customer media that isn't stored yet comes through the proxy as a blob.
  async function openFromProxy(e: React.MouseEvent) {
    if (directSrc || !mediaMsgId) return;
    e.preventDefault();
    setOpening(true);
    try {
      const blob = await apiFetchMediaBlob(mediaMsgId);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      // Media gone from WhatsApp — nothing to open.
    } finally {
      setOpening(false);
    }
  }

  return (
    <a
      href={directSrc ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openFromProxy}
      aria-disabled={!available}
      className={`flex items-center gap-3 w-[260px] max-w-full rounded-xl bg-black/5 dark:bg-black/25 px-3 py-2.5 transition-colors ${
        available ? "hover:bg-black/10 cursor-pointer" : "opacity-60 pointer-events-none"
      }`}
    >
      <span className={`relative w-9 h-11 shrink-0 rounded-md ${kind.badge} text-white flex items-end justify-center pb-1.5`}>
        <FileText className="absolute top-1.5 w-4 h-4 opacity-80" />
        <span className="text-[9px] font-bold tracking-wide">{(ext ?? "file").toUpperCase()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-gray-900 truncate">{kind.label}</span>
        <span className="block text-[11.5px] text-gray-500">
          {!available ? "Not available" : opening ? "Opening…" : kind.viewable ? "Click to view" : "Click to download"}
        </span>
      </span>
      {opening ? <Loader2 className="w-4 h-4 shrink-0 text-gray-500 animate-spin" /> : <Icon className="w-4 h-4 shrink-0 text-gray-500" />}
    </a>
  );
}

function MessageContent({ msg, isAgent }: { msg: Message; isAgent: boolean }) {
  if (msg.deletedAt) {
    return (
      <p className="text-[13px] italic flex items-center gap-1.5 text-gray-400">
        <Trash2 className="w-3.5 h-3.5" />
        This message was deleted
      </p>
    );
  }

  // Agent media:    URL lives in content (mediaUrl is always null for agent-sent)
  // Customer media: URL lives in mediaUrl (permanent storage, set after upload)
  const resolvedUrl = msg.mediaUrl ?? null;
  const directSrc = resolvedUrl ?? (isAgent ? (msg.content || null) : null);
  // Fallback for customer media whose background upload failed/hasn't finished:
  // the proxy re-requests a FRESH download URL from the stored mediaId and
  // permanently self-heals the message, so it works for as long as Meta retains
  // the file (days) — not just the ~5 min the temporary URL itself lasts.
  const msgDbId = msg.id != null && !Number.isNaN(Number(msg.id)) ? Number(msg.id) : null;
  const mediaMsgId = !directSrc && !isAgent && msgDbId ? msgDbId : null;

  if (msg.messageType === "IMAGE") return <ImageMessage directSrc={directSrc} mediaMsgId={mediaMsgId} />;
  // VIDEO: never proxy-fetch (large file — stalls/fails as blob). Use Cloudinary URL
  // directly; show placeholder until media_ready fires if not yet available.
  if (msg.messageType === "VIDEO") return <VideoMessage src={directSrc} />;
  if (msg.messageType === "AUDIO") return <AudioMessage directSrc={directSrc} mediaMsgId={mediaMsgId} />;
  if (msg.messageType === "DOCUMENT") return <DocumentMessage directSrc={directSrc} mediaMsgId={mediaMsgId} />;
  if (msg.messageType === "STICKER") {
    if (!directSrc) return <p className="text-[13px] text-gray-400 italic">Sticker (loading…)</p>;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={directSrc} alt="sticker" className="w-40 h-40 object-contain" />
    );
  }

  return (
    <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[#1F2A24]">
      {/* *bold*, _italic_, ~strike~ as WhatsApp shows them, not the raw markers */}
      <WaText text={msg.content} />
    </p>
  );
}

function MediaPreviewPanel({
  files,
  onSend,
  onClose,
  onAddMore,
  onRemove,
}: {
  files: File[];
  onSend: (files: File[], captions: string[]) => void;
  onClose: () => void;
  onAddMore: (f: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [captions, setCaptions] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const addMoreRef = useRef<HTMLInputElement>(null);

  // Keep captions array in sync with files length
  useEffect(() => {
    startTransition(() => {
      setCaptions((prev) => files.map((_, i) => prev[i] ?? ""));
    });
  }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    startTransition(() => {
      setPreviews(urls);
      setActiveIdx((i) => Math.min(i, files.length - 1));
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const activeFile = files[activeIdx];
  const activeSrc  = previews[activeIdx];
  const isImg = activeFile?.type.startsWith("image/");
  const isVid = activeFile?.type.startsWith("video/");
  const isAud = activeFile?.type.startsWith("audio/");

  function removeFile(e: React.MouseEvent, i: number) {
    e.stopPropagation();
    onRemove(i);
  }

  return (
    <div className="relative z-20 flex-1 flex flex-col bg-[#f0f2f5] overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <span className="text-[13px] font-medium text-gray-500 truncate max-w-[60%] text-center">
          {activeFile?.name ?? "Preview"}
        </span>
        <div className="w-8" />
      </div>

      {/* Preview */}
      <div className="flex-1 flex items-center justify-center p-8 min-h-0">
        {activeSrc && isImg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activeSrc} alt="Preview" className="max-w-full max-h-full object-contain rounded-xl select-none shadow-sm" />
        )}
        {activeSrc && isVid && (
          <video src={activeSrc} controls className="max-w-full max-h-full rounded-xl shadow-sm" />
        )}
        {activeSrc && isAud && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 110 18A9 9 0 0112 3zm0 2a7 7 0 100 14A7 7 0 0012 5zm0 3a1 1 0 011 1v4.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 0111 14V9a1 1 0 011-1z"/></svg>
            </div>
            <audio src={activeSrc} controls className="w-64" />
          </div>
        )}
        {!isImg && !isVid && !isAud && activeFile && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center">
              <Download className="w-10 h-10 text-gray-400" />
            </div>
            <p className="text-[13px] text-gray-500 max-w-[220px] text-center break-all">{activeFile.name}</p>
          </div>
        )}
      </div>

      {/* Caption + Send */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-white border-t border-gray-100">
        <div className="flex-1 bg-gray-100 rounded-full px-4 py-2.5">
          <input
            type="text"
            value={captions[activeIdx] ?? ""}
            onChange={(e) =>
              setCaptions((prev) => {
                const next = [...prev];
                next[activeIdx] = e.target.value;
                return next;
              })
            }
            placeholder="Type a message…"
            className="w-full bg-transparent text-[14px] text-gray-700 placeholder:text-gray-400 outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") onSend(files, captions); }}
          />
        </div>
        <button
          type="button"
          onClick={() => onSend(files, captions)}
          className="h-11 px-4 rounded-full bg-brand hover:bg-[#2f5840] flex items-center gap-2 text-white transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-[18px] h-[18px]" />
          {files.length > 1 && (
            <span className="bg-white/25 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
              {files.length}
            </span>
          )}
        </button>
      </div>

      {/* File strip */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100 overflow-x-auto">
        {files.map((f, i) => {
          const src = previews[i];
          return (
            <div key={i} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all cursor-pointer block ${i === activeIdx ? "border-brand scale-105" : "border-gray-200 opacity-60 hover:opacity-90"}`}
              >
                {f.type.startsWith("image/") && src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <Download className="w-5 h-5 text-gray-400" />
                  </div>
                )}
              </button>
              {/* Remove button */}
              <button
                type="button"
                onClick={(e) => removeFile(e, i)}
                className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-gray-600 dark:bg-gray-300 hover:bg-red-500 text-white flex items-center justify-center transition-colors cursor-pointer z-10"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}

        {/* Add more */}
        <input
          ref={addMoreRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => {
            const added = Array.from(e.target.files ?? []);
            if (added.length) onAddMore(added);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => addMoreRef.current?.click()}
          className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-gray-300 hover:border-brand flex items-center justify-center text-gray-400 hover:text-brand-fg transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M8 2v12M2 8h12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplatePickerModal
// ---------------------------------------------------------------------------

function TemplatePickerModal({
  conversationId,
  category,
  customerName,
  agentName,
  onClose,
  onSent,
  beforeSend,
  guardedSend,
  optOut,
}: {
  conversationId: string;
  category: "GENERAL" | "RE_ENGAGEMENT";
  customerName: string;
  agentName: string;
  onClose: () => void;
  onSent: () => void;
  /** Asks "reply anyway?" when a colleague owns the chat; false = cancelled. */
  beforeSend: () => Promise<boolean>;
  /** Sends, re-asking once if the server says a colleague owns the chat. */
  guardedSend: <T>(send: (confirmOtherOwner: boolean) => Promise<T>) => Promise<T>;
  /** The patient's marketing opt-out: warns before choosing, marks marketing templates. */
  optOut: OptOutState | null;
}) {
  // One id for this template send: a double click returns the first send.
  const clientIdRef = useRef(crypto.randomUUID());
  const sendingRef = useRef(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTpls, setLoadingTpls] = useState(true);
  const [selected, setSelected] = useState<Template | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server refused a marketing template: the patient opted out (409 OPTED_OUT).
  const [optOutPrompt, setOptOutPrompt] = useState<"line" | "all" | null>(null);
  const optedOut = isOptedOut(optOut);
  // Agents send general and utility templates only; marketing ones stay hidden.
  const { can } = useCurrentUser();
  const canMarketing = can("template:send_marketing");
  const optOutWhere = optOut?.all ? "all lines" : "this line";

  // Outside the 24-hour window only a Meta-approved template can be sent — the
  // same rule the server enforces (utils/templateSend.js needsMetaTemplate): not
  // GENERAL, APPROVED, and submitted to Meta under a name. So that picker lists
  // every such template, whatever its category, and nothing that would bounce.
  const windowClosedMode = category === "RE_ENGAGEMENT";
  useEffect(() => {
    apiGetTemplates(windowClosedMode ? { status: "APPROVED" } : { category, status: "APPROVED" })
      .then((res) =>
        setTemplates(
          // Imported templates still needing setup (needsSetup) can't be sent.
          (windowClosedMode
            ? res.data.filter((t) => t.category !== "GENERAL" && !!t.metaTemplateName)
            : res.data
          ).filter((t) => !t.needsSetup?.length && (canMarketing || !isMarketingTemplate(t))),
        ),
      )
      .catch(() => {})
      .finally(() => setLoadingTpls(false));
  }, [category, windowClosedMode, canMarketing]);

  function previewBody(body: string) {
    return body
      .replace(/\{\{customer_name\}\}/g, customerName || "Customer")
      .replace(/\{\{agent_name\}\}/g, agentName || "Agent");
  }

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.body.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSend() {
    if (!selected || sendingRef.current) return;
    sendingRef.current = true;
    if (!(await beforeSend())) {
      sendingRef.current = false;
      return;
    }
    await send(selected.id, false);
  }

  // confirmOptedOut: the agent confirmed the opted-out patient asked for it.
  // Same clientMessageId on the retry: the refused try created nothing.
  async function send(templateId: number, confirmOptedOut: boolean) {
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await guardedSend((confirmOtherOwner) =>
        apiSendTemplate(conversationId, templateId, { clientMessageId: clientIdRef.current, confirmOtherOwner, confirmOptedOut }),
      );
      onSent();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send template";
      if (err instanceof ApiError && err.code === "OPTED_OUT") {
        setOptOutPrompt(err.details?.scope === "all" ? "all" : "line");
      } else if (isWindowClosedError(err)) {
        setError("The 24-hour window is closed, and this template isn't approved by Meta — pick an approved one.");
      } else if (msg.toLowerCase().includes("approved")) {
        setError("This template is pending Meta approval.");
      } else {
        setError(msg);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ height: "80vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">
              {windowClosedMode ? "Send an approved template" : "Insert Template"}
            </h2>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {windowClosedMode
                ? "The 24-hour window is closed — only Meta-approved templates can be sent"
                : "Only approved templates are shown"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* List panel */}
          <div className="w-64 shrink-0 border-r border-gray-100 flex flex-col">
            {optedOut && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border-b border-red-100">
                <ShieldOff className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-red-700 leading-snug">
                  <span className="font-semibold">Opted out of marketing ({optOutWhere}).</span>{" "}
                  Marketing templates are marked. Only send one if the patient asked for it.
                </p>
              </div>
            )}
            <div className="px-3 py-3 border-b border-gray-100">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full text-[13px] text-gray-600 placeholder:text-gray-400 outline-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2"
              />
            </div>
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
              {loadingTpls ? (
                <div className="flex items-center justify-center h-20">
                  <Spinner size="md" label="Loading templates" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[13px] text-gray-400">
                    {templates.length === 0
                      ? "No approved templates"
                      : "No templates match your search."}
                  </p>
                </div>
              ) : (
                filtered.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => { setSelected(tpl); setError(null); }}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${
                      selected?.id === tpl.id ? "bg-brand-100 border-l-2 border-l-brand" : ""
                    }`}
                  >
                    <p className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-medium text-gray-900 truncate">{tpl.name}</span>
                      {optedOut && isMarketingTemplate(tpl) && (
                        <span className="shrink-0 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-full px-1.5">
                          Marketing
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate mt-0.5">{tpl.body.slice(0, 50)}…</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Preview panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {selected ? (
              <>
                <div className="flex-1 p-6 overflow-y-auto">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Preview</p>
                  <div className="bg-[#f0f2f5] rounded-xl p-4 max-w-[340px]">
                    {selected.header && (
                      <p className="text-[12px] font-semibold text-gray-700 mb-1">{selected.header}</p>
                    )}
                    <div className="bg-white rounded-xl rounded-tl-sm px-4 py-3 shadow-sm">
                      <p className="text-[14px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                        {previewBody(selected.body)}
                      </p>
                      {selected.footer && (
                        <p className="text-[11px] text-gray-400 italic mt-1">{selected.footer}</p>
                      )}
                    </div>
                    {selected.buttons && selected.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selected.buttons.map((btn) => (
                          <span key={btn.id} className="text-[12px] font-medium text-blue-600 bg-white border border-blue-100 px-3 py-1 rounded-full shadow-sm">
                            {btn.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {optedOut && isMarketingTemplate(selected) && (
                  <div className="px-6 pb-3">
                    <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                      This is a marketing template and the patient opted out of marketing ({optOutWhere}). Only send it if they asked for it.
                    </p>
                  </div>
                )}
                {error && (
                  <div className="px-6 pb-3">
                    <p className="text-[13px] text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
                  </div>
                )}
                <div className="px-6 pb-5 shrink-0">
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending}
                    className="w-full py-2.5 bg-brand hover:bg-[#2f5840] disabled:opacity-60 text-[14px] font-semibold text-white rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {sending ? "Sending…" : category === "RE_ENGAGEMENT" ? "Send Re-engagement" : "Send Template"}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-6">
                <div>
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <LayoutTemplate className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-[13px] text-gray-400">Select a template to preview it</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {optOutPrompt && selected && (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4" onClick={() => setOptOutPrompt(null)}>
          <div role="alertdialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-[400px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1.5 flex items-center gap-2">
              <ShieldOff className="w-4 h-4 text-red-500" /> Patient opted out of marketing
            </h3>
            <p className="text-[13px] text-gray-500 mb-5">
              This patient opted out of marketing ({optOutPrompt === "all" ? "all lines" : "this line"}). Only send
              &ldquo;{selected.name}&rdquo; if they asked for it. The send is recorded in the audit log.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setOptOutPrompt(null)} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer">
                Don&apos;t send
              </button>
              <button
                type="button"
                onClick={() => { const tid = selected.id; setOptOutPrompt(null); void send(tid, true); }}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 cursor-pointer"
              >
                They asked for it. Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}


export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { resolvedTheme } = useTheme();
  const { conversations, loading: conversationsLoading, markRead } = useConversationsContext();
  const conversation = conversations.find((c) => String(c.id ?? c._id) === id);
  // Conversation ids are global integers, so a bookmarked or pasted link can
  // point at a thread belonging to a different WhatsApp number. Once the list has
  // loaded and the id still isn't in it, this thread is not on the active number
  // — go back to the inbox rather than rendering a headless conversation.
  //
  // Guarded on !loading so it cannot fire during the normal load window, and on
  // length so an empty inbox doesn't bounce the user in a loop.
  const conversationMissing = !conversationsLoading && !conversation && conversations.length > 0;
  useEffect(() => {
    if (conversationMissing) router.replace("/chats");
  }, [conversationMissing, router]);
  const customer = conversation?.customer ?? null;

  const {
    messages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    appendOptimistic,
    confirmOptimistic,
    discardOptimistic,
    typingUsers,
  } = useMessages(id);
  const { can } = useCurrentUser();
  // Marketing opt-out (this line / all lines): banner, Follow up menu, template picker.
  const optOut = useOptOutState(id);

  // The server said the window is closed (the client's clock or data may have
  // disagreed). Take the bubble back, keep what was typed, and go straight to
  // the one thing that can be sent.
  function handleWindowClosed(err: unknown, tempId: string, text?: string): boolean {
    if (!isWindowClosedError(err)) return false;
    discardOptimistic(tempId);
    if (text) setMessage((m) => m || text);
    toast.error(err instanceof Error ? err.message : "The 24-hour window is closed.");
    setReengagementOpen(true);
    return true;
  }

  const [message, setMessage] = useState("");
  // A send in flight. A ref, not state: two Enter presses inside one render
  // both saw `sending === false` and sent the message twice.
  const sendingRef = useRef(false);
  // "This chat is assigned to <name> — reply anyway?" (asked once per chat).
  const [ownerPrompt, setOwnerPrompt] = useState<string | null>(null);
  const ownerPromptResolve = useRef<((ok: boolean) => void) | null>(null);
  const ownerOkRef = useRef<string | null>(null);
  // WhatsApp-Web-style contact panel on the right (header click / info button).
  const [showInfo, setShowInfo] = useState(false);
  // When "typing…" was last sent to the customer for this chat.
  const customerTypingSentRef = useRef(0);
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<QuotedMessage | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [reengagementOpen, setReengagementOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [agentCache, setAgentCache] = useState<Record<string, string>>({});
  const [user, setUser] = useState<{
    id: string | number;
    username: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number } | null>(null);
  const [deletingMsg, setDeletingMsg] = useState(false);

  async function handleConfirmDeleteMessage() {
    if (!deleteTarget) return;
    setDeletingMsg(true);
    try {
      await apiDeleteMessage(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete message.");
    } finally {
      setDeletingMsg(false);
    }
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem("user");
      if (stored) {
        const parsed = JSON.parse(stored);
        startTransition(() => {
          setUser(parsed);
          // Pre-seed cache so the current user's messages never fall through to the API fetch
          if (parsed?.id != null) {
            setAgentCache((prev) => ({
              [String(parsed.id)]: parsed.username,
              ...prev,
            }));
          }
        });
      }
    } catch {}
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevLastMsgKeyRef = useRef("");
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    function onPointerDown(e: PointerEvent) {
      if (
        emojiPickerRef.current?.contains(e.target as Node) ||
        emojiButtonRef.current?.contains(e.target as Node)
      ) return;
      setShowEmojiPicker(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showEmojiPicker]);

  // Mark as read when leaving the conversation
  useEffect(() => {
    return () => {
      markRead(id);
    };
  }, [id, markRead]);

  // Scroll to bottom on initial load (instant, no animation)
  useEffect(() => {
    if (!loading) {
      const el = messagesContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [loading]);

  // After messages change: restore position (load more) or scroll to bottom (new message)
  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current > 0) {
      // Prepend happened — restore scroll so the view doesn't jump
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
    } else if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Count new customer messages arriving while scrolled up
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    const key = last._id != null ? String(last._id) : last.id != null ? String(last.id) : "";
    if (!key || key === prevLastMsgKeyRef.current) return;
    prevLastMsgKeyRef.current = key;
    if (!isNearBottomRef.current && String(last.senderType) === "CUSTOMER") {
      setUnreadCount((n) => n + 1);
    }
  }, [messages]);

  // Reset unread counter when switching conversations
  useEffect(() => {
    setUnreadCount(0);
    setShowScrollDown(false);
    prevLastMsgKeyRef.current = "";
    isNearBottomRef.current = true; // a newly opened chat starts at its last message
  }, [id]);

  // Images, product cards and video posters load AFTER the first scroll to the
  // bottom and push the content down — which used to leave a freshly opened
  // chat sitting above its real last message. While the reader is at the
  // bottom, every media load keeps it there. (load doesn't bubble, so listen
  // in the capture phase.) Scrolling up stops this, as it should.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const stick = () => {
      if (isNearBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", stick, true);
    el.addEventListener("loadedmetadata", stick, true);
    return () => {
      el.removeEventListener("load", stick, true);
      el.removeEventListener("loadedmetadata", stick, true);
    };
  }, [id, loading]);

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
    if (nearBottom) setUnreadCount(0);
    if (el.scrollTop < 80 && hasMore && !loadingMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      loadMore();
    }
  }

  // Fetch names for any agent senderIds not already known
  useEffect(() => {
    const unknownIds = [
      ...new Set(
        messages
          .filter((m) => m.senderType === "AGENT" && m.senderId != null)
          .map((m) => String(m.senderId))
          .filter((sid) => {
            if (user && String(user.id) === sid) return false;
            if (
              conversation?.assignedAgent &&
              String(conversation.assignedAgent.id) === sid
            )
              return false;
            if (agentCache[sid]) return false;
            return true;
          }),
      ),
    ];
    if (unknownIds.length === 0) return;
    unknownIds.forEach(async (sid) => {
      try {
        const res = await apiGetUser(sid);
        setAgentCache((prev) => ({ ...prev, [sid]: res.data.username }));
      } catch {
        setAgentCache((prev) => ({ ...prev, [sid]: `Agent ${sid}` }));
      }
    });
  }, [messages, user, conversation?.assignedAgent, agentCache]);

  function handleTypingStop() {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (user?.username) {
      emitTypingStop(id, user.username);
    }
  }

  function highlightEl(row: HTMLElement) {
    row.classList.remove("msg-highlight");
    void row.offsetHeight;
    row.classList.add("msg-highlight");
    row.addEventListener("animationend", () => row.classList.remove("msg-highlight"), { once: true });
  }

  function scrollToMessage(msgId: number) {
    const container = messagesContainerRef.current;
    const row = document.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`);
    if (!row || !container) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const targetScrollTop =
      container.scrollTop + rowRect.top - containerRect.top - container.clientHeight / 2 + rowRect.height / 2;
    container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    highlightEl(row);
  }

  function askReplyAnyway(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      ownerPromptResolve.current = resolve;
      setOwnerPrompt(name);
    });
  }
  function answerOwnerPrompt(ok: boolean) {
    const resolve = ownerPromptResolve.current;
    ownerPromptResolve.current = null;
    setOwnerPrompt(null);
    resolve?.(ok);
  }
  // True when this person may send here now: free chats and their own chats
  // straight away; a colleague's chat after one "reply anyway" per chat.
  async function confirmOwnership(): Promise<boolean> {
    const owner = conversation?.assignedAgent;
    if (!owner || String(owner.id) === String(user?.id) || ownerOkRef.current === id) return true;
    const ok = await askReplyAnyway(owner.name || owner.username);
    if (ok) ownerOkRef.current = id;
    return ok;
  }
  // Sends; if the server says a colleague owns the chat (this screen was out of
  // date), asks once and retries with the same message id — never a duplicate.
  async function guardedSend<T>(send: (confirmOtherOwner: boolean) => Promise<T>): Promise<T> {
    try {
      return await send(ownerOkRef.current === id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ASSIGNED_TO_OTHER") {
        const owner = (err.details as { assignee?: { name?: string | null; username: string } | null } | undefined)?.assignee;
        if (await askReplyAnyway(owner ? owner.name || owner.username : "a colleague")) {
          ownerOkRef.current = id;
          return await send(true);
        }
      }
      throw err;
    }
  }

  async function handleSend() {
    const text = message.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    if (!(await confirmOwnership())) {
      sendingRef.current = false;
      return;
    }
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSending(true);

    // Capture reply context then clear it
    const quotedMsg = replyingTo;
    setReplyingTo(null);

    // Stop typing indicator on send
    handleTypingStop();

    // Runs on Send, not during render — the purity rule misreads this handler.
    // eslint-disable-next-line react-hooks/purity
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      _id: tempId,
      conversationId: id,
      senderType: "AGENT",
      senderId: null,
      content: text,
      messageType: "TEXT",
      status: null, // null = still sending
      createdAt: new Date().toISOString(),
      quotedMessageId: quotedMsg?.id ?? undefined,
      quotedMessage: quotedMsg ?? undefined,
    };
    isNearBottomRef.current = true;
    appendOptimistic(optimistic);

    try {
      const clientMessageId = crypto.randomUUID();
      const res = await guardedSend((confirmOtherOwner) =>
        apiSendMessage(id, text, undefined, "TEXT", quotedMsg?.id ?? undefined, { clientMessageId, confirmOtherOwner }),
      );
      // Backend may use `id` or `_id` — handle both
      const realId =
        ((res.data as Record<string, unknown>)._id as string) ??
        ((res.data as Record<string, unknown>).id as string);
      confirmOptimistic(tempId, {
        ...optimistic,
        _id: realId,
        status: res.data.status,
      });
    } catch (err) {
      if (!handleWindowClosed(err, tempId, text)) {
        confirmOptimistic(tempId, { ...optimistic, status: "FAILED" });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/") ||
      f.type.startsWith("video/") ||
      f.type.startsWith("audio/") ||
      f.type === "application/pdf" ||
      f.type.includes("word") ||
      f.type.includes("excel") ||
      f.type.includes("spreadsheet") ||
      f.type.includes("document")
    );
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files]);
  }

  async function handleSendPending(files: File[], captions: string[]) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    if (!(await confirmOwnership())) {
      sendingRef.current = false;
      return;
    }
    setPendingFiles([]);
    handleTypingStop();
    setSending(true);

    // Build all optimistic messages upfront (text + media pairs) so they all
    // appear in "sending" state immediately before any network requests start.
    type OptimisticPair = { textTempId: string | null; textMsg: Message | null; mediaTempId: string; mediaMsg: Message; file: File };
    const pairs: OptimisticPair[] = files.map((file, i) => {
      const caption = (captions[i] ?? "").trim();
      const msgType: Message["messageType"] =
        file.type.startsWith("image/") ? "IMAGE" :
        file.type.startsWith("video/") ? "VIDEO" :
        file.type.startsWith("audio/") ? "AUDIO" : "DOCUMENT";

      // Text optimistic (if caption exists)
      let textTempId: string | null = null;
      let textMsg: Message | null = null;
      if (caption) {
        textTempId = `temp-${Date.now()}-${Math.random()}`;
        textMsg = {
          _id: textTempId,
          conversationId: id,
          senderType: "AGENT",
          senderId: null,
          content: caption,
          messageType: "TEXT",
          status: null,
          createdAt: new Date().toISOString(),
        };
        isNearBottomRef.current = true;
        appendOptimistic(textMsg);
      }

      // Media optimistic
      const mediaTempId = `temp-${Date.now()}-${Math.random()}`;
      const mediaMsg: Message = {
        _id: mediaTempId,
        conversationId: id,
        senderType: "AGENT",
        senderId: null,
        content: URL.createObjectURL(file),
        messageType: msgType,
        status: null,
        createdAt: new Date().toISOString(),
      };
      isNearBottomRef.current = true;
      appendOptimistic(mediaMsg);

      return { textTempId, textMsg, mediaTempId, mediaMsg, file };
    });

    // Send each pair sequentially: TEXT first, then media
    for (const { textTempId, textMsg, mediaTempId, mediaMsg, file } of pairs) {
      // 1. Send caption text first (if present)
      if (textTempId && textMsg) {
        try {
          const clientMessageId = crypto.randomUUID();
          const res = await guardedSend((confirmOtherOwner) =>
            apiSendMessage(id, textMsg.content, undefined, "TEXT", undefined, { clientMessageId, confirmOtherOwner }),
          );
          const realId =
            ((res.data as Record<string, unknown>)._id as string) ??
            String((res.data as Record<string, unknown>).id);
          confirmOptimistic(textTempId, { ...textMsg, _id: realId, status: res.data.status });
        } catch (err) {
          if (!handleWindowClosed(err, textTempId, textMsg.content)) {
            confirmOptimistic(textTempId, { ...textMsg, status: "FAILED" });
          }
        }
      }

      // 2. Then send the media file
      try {
        const { url, messageType } = await apiUploadMedia(file);
        const clientMessageId = crypto.randomUUID();
        const res = await guardedSend((confirmOtherOwner) =>
          apiSendMessage(id, "", url, messageType, undefined, { clientMessageId, confirmOtherOwner }),
        );
        const realId =
          ((res.data as Record<string, unknown>)._id as string) ??
          String((res.data as Record<string, unknown>).id);
        confirmOptimistic(mediaTempId, { ...mediaMsg, _id: realId, content: url, mediaUrl: url, messageType, status: res.data.status });
      } catch (err) {
        if (!handleWindowClosed(err, mediaTempId)) {
          confirmOptimistic(mediaTempId, { ...mediaMsg, status: "FAILED" });
        }
      }
    }

    sendingRef.current = false;
    setSending(false);
  }

  const initials = (() => {
    const src = customer?.name || customer?.phone;
    if (!src) return "?";
    return src
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  })();

  // Re-evaluated every minute, so a window that expires while this thread is
  // open locks the composer without a reload. Waits for the conversation: while
  // it is still loading there is nothing to judge, and "unknown" must not read
  // as "closed" (a never-messaged contact counts as closed — see the helper).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const windowClosed = conversation ? isWindowClosed(conversation.lastCustomerMessageAt, nowTick) : false;

  return (
    <div className="relative flex h-full min-h-0">
    <div
      className="relative flex flex-col h-full flex-1 min-w-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-brand">
            <Paperclip className="w-10 h-10 text-brand-fg" />
            <p className="text-[15px] font-semibold text-brand-fg">Drop files to send</p>
          </div>
        </div>
      )}

      {/* Chat background — tiled, stays fixed while messages scroll */}
      <div className="absolute inset-0 pointer-events-none z-0 bg-[#EFEAE2]" />

      {/* Header. Above the banner and messages (z-10): its Status / Follow up /
          Assignee menus open downwards over them. */}
      <div className="relative z-30 flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-100 shrink-0">
        <button
          type="button"
          onClick={() => router.push("/chats")}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          title="Contact info"
          className="flex-1 min-w-0 flex items-center gap-3 text-left rounded-xl -ml-1 pl-1 py-0.5 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <span className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-fg font-bold text-[13px] shrink-0">
            {initials}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-[14px] text-gray-900 leading-tight truncate">
              {customer?.name || customer?.phone || "Loading…"}
            </span>
            <span className="block text-[12px] text-gray-400 leading-tight truncate">
              {customer?.name && customer?.phone ? `${customer.phone} · ` : ""}Click for contact info
            </span>
          </span>
        </button>



        {/* Lifecycle, follow-up and owner. All update live from the server's socket events,
            which patch the conversation list this header reads from. */}
        {conversation && (
          <>
            <ConversationOutcomeControl
              conversationId={id}
              outcome={(conversation as InboxConversation).outcome ?? null}
              followUpAt={(conversation as InboxConversation).followUpAt ?? null}
              optOut={optOut}
            />
            <AssigneePicker conversationId={id} assignee={conversation.assignedAgent ?? null} />
          </>
        )}
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          title={showInfo ? "Hide contact info" : "Contact info"}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 ${showInfo ? "bg-brand-100 text-brand-fg" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"}`}
        >
          <PanelRight className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Opted out of marketing: replying is fine, offers / campaign templates aren't */}
      <OptOutBanner conversationId={id} state={optOut} />

      {/* File preview panel — replaces messages + input when files are queued */}
      {pendingFiles.length > 0 && (
        <MediaPreviewPanel
          files={pendingFiles}
          onSend={handleSendPending}
          onClose={() => setPendingFiles([])}
          onAddMore={(f) => setPendingFiles((prev) => [...prev, ...f])}
          onRemove={(i) =>
            setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))
          }
        />
      )}

      {/* Messages */}
      {pendingFiles.length === 0 && (loading ? (
        <div className="relative z-10 flex flex-1 items-center justify-center">
          {/* On a card rather than straight on the chat background: the patterned
              wallpaper swallowed a bare spinner. */}
          <div className="flex items-center gap-3 bg-white/95 border border-gray-100 shadow-sm rounded-2xl px-5 py-3.5">
            <Spinner size="md" label="Loading messages" />
            <span className="text-[13px] font-medium text-gray-600" aria-hidden>Loading messages…</span>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 z-10 min-h-0">
          <div
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden px-4 md:px-8 py-4 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-brand/20 [&::-webkit-scrollbar-thumb]:rounded-full"
          >
          {loadingMore && (
            <div className="flex justify-center py-2">
              <Spinner size="sm" label="Loading older messages" />
            </div>
          )}
          {messages.map((msg, i) => {
            const mid =
              msg._id != null
                ? String(msg._id)
                : msg.id != null
                  ? String(msg.id)
                  : `msg-${i}`;
            const isSending = mid.startsWith("temp-");

            const isMediaMsg = msg.messageType === "AUDIO" || msg.messageType === "VIDEO" || msg.messageType === "STICKER";
            const prevForGroup = i > 0 ? messages[i - 1] : undefined;
            const groupStart = !sameGroup(prevForGroup, msg);
            const groupEnd = !sameGroup(msg, messages[i + 1]);
            const newDay = !prevForGroup || new Date(prevForGroup.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
            const rowGap = newDay ? "mt-1" : groupStart ? "mt-3" : "mt-0.5";

            const row = msg.senderType === "CUSTOMER" ? (
              <div key={mid} data-msg-id={mid} className={`group/msg flex justify-start items-end gap-1 ${rowGap}`}>
                <div className={isMediaMsg ? "" : "max-w-[65%] min-w-0"}>
                  {msg.campaignRecipient?.campaign && (
                    <CampaignReplyTag campaign={msg.campaignRecipient.campaign} linkable={can("campaign:read")} />
                  )}
                  {isMediaMsg ? (
                    <div>
                      <MessageContent msg={msg} isAgent={false} />
                      <div className="bg-white border border-[#D6DED9] rounded-xl px-2.5 py-0.5 inline-flex mt-1">
                        <p className="text-[10px] text-gray-400">{formatMessageTime(msg.createdAt)}</p>
                      </div>
                    </div>
                  ) : (
                    // White on the plain grey-green canvas: the customer's own words,
                    // distinct from the team's green and the automation's slate.
                    <div className={`msg-bubble bg-white border border-[#D6DED9] rounded-2xl ${groupStart ? "rounded-tl-md" : ""} px-3.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(16,24,20,0.08)]`}>
                      {msg.quotedMessage && (() => {
                        const qm = msg.quotedMessage;
                        const qImg = !qm.deletedAt && qm.messageType === "IMAGE" ? (qm.mediaUrl ?? qm.content) : null;
                        return (
                          <div onClick={() => scrollToMessage(qm.id)} className="border-l-2 border-brand/60 pl-2 mb-2 py-0.5 pr-1 bg-brand/5 rounded-r-sm cursor-pointer hover:bg-brand/10 transition-colors">
                            <p className="text-[10px] font-semibold text-brand-fg leading-tight">
                              {qm.senderType === "CUSTOMER" ? customer?.name || "Contact" : "You"}
                            </p>
                            {qm.deletedAt ? (
                              <p className="text-[12px] text-gray-400 italic truncate leading-tight">This message was deleted</p>
                            ) : qImg ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={qImg} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                <span className="text-[12px] text-gray-500">Photo</span>
                              </div>
                            ) : (
                              <p className="text-[12px] text-gray-500 truncate leading-tight">
                                {messagePreview(qm)}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <MessageContent msg={msg} isAgent={false} />
                      <p className="text-[10px] text-gray-400 text-right mt-0.5 -mb-0.5">
                        {formatMessageTime(msg.createdAt)}
                      </p>
                    </div>
                  )}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {Object.entries(msg.reactions).map(([emoji, count]) => (
                        <span key={emoji} className="bg-white border border-gray-200 shadow-sm rounded-full px-1.5 py-0.5 flex items-center gap-0.5 leading-none">
                          <span className="text-base leading-none">{emoji}</span>
                          {count > 1 && <span className="text-[11px] text-gray-500 font-medium">{count}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <MessageMenu
                  align="left"
                  onReply={() => setReplyingTo({ id: Number(msg.id ?? msg._id), content: msg.content, messageType: msg.messageType, senderType: msg.senderType, mediaUrl: msg.mediaUrl })}
                  copyText={msg.messageType === "TEXT" ? msg.content : null}
                />
              </div>
            ) : (
              (() => {
                // A flow's message has no human sender: show it as the automation,
                // never as whoever happens to be looking at the chat.
                const agent = msg.senderType === "BOT"
                  ? { initials: "⚡", color: "#64748B", name: "Automation" }
                  : getAgentAvatar(
                      msg.senderId,
                      user,
                      conversation?.assignedAgent ?? null,
                      agentCache,
                    );
                const senderChanged = groupStart;
                const isBot = msg.senderType === "BOT";
                // WhatsApp-Web-like: team replies are WhatsApp green, automation
                // (flows) soft blue, the patient white on a beige canvas — so
                // anyone can tell at a glance who actually wrote it.
                const bubbleTone = isBot ? "bg-[#DDEBFA] border-[#B9D3F0]" : "bg-[#D9FDD3] border-[#BFE6B6]";
                const nameLabel = (
                  <p className="text-[11px] font-medium text-gray-500 text-right mb-1 flex items-center justify-end gap-1">
                    {isBot && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1 border text-[#64748B] bg-[#EEF2F6] border-[#DCE3EB]">
                        Automation
                      </span>
                    )}
                    {!isBot && agent.name}
                  </p>
                );
                const avatar = groupEnd ? (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 cursor-default select-none"
                    style={{ backgroundColor: agent.color }}
                    title={agent.name}
                  >
                    {agent.initials}
                  </div>
                ) : (
                  <div className="w-7 shrink-0" />
                );

                // Template message — special rendering. TEMPLATE is a Meta-approved
                // template send; INTERACTIVE is an ad-hoc one. Both store the same
                // JSON shape, so both render as a template bubble.
                const tpl =
                  msg.messageType === "INTERACTIVE" || msg.messageType === "TEMPLATE"
                    ? parseTemplateContent(msg.content)
                    : null;
                if (tpl) {
                  return (
                    <div key={mid} data-msg-id={mid} className={`group/msg flex justify-end items-end gap-1.5 ${rowGap}`}>
                      <MessageMenu
                        onReply={() => setReplyingTo({ id: Number(msg.id ?? msg._id), content: tpl.body, messageType: msg.messageType, senderType: msg.senderType, mediaUrl: null })}
                        copyText={tpl.body}
                        onDelete={!isSending && !msg.deletedAt && String(msg.senderId) === String(user?.id) ? () => setDeleteTarget({ id: Number(msg.id ?? msg._id) }) : undefined}
                      />
                      <div className="max-w-[65%] min-w-0">
                        {senderChanged && nameLabel}
                        {/* Bubble — header / body / footer / timestamp */}
                        <div className={`msg-bubble ${bubbleTone} border rounded-2xl ${groupStart ? "rounded-tr-md" : ""} px-3.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(16,24,20,0.08)] transition-opacity ${isSending ? "opacity-75" : "opacity-100"}`}>
                          {tpl.headerType === "TEXT" && tpl.header && (
                            <p className="text-[14px] font-bold text-[#1F2A24] mb-1 leading-snug">{tpl.header}</p>
                          )}
                          {tpl.headerType === "IMAGE" && tpl.headerMediaUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={tpl.headerMediaUrl} alt="" className="w-full max-h-48 object-cover rounded-lg mb-1.5" />
                          )}
                          {tpl.headerType === "VIDEO" && tpl.headerMediaUrl && (
                            <div className="flex items-center gap-2 bg-black/5 dark:bg-black/25 rounded-lg px-2.5 py-3 mb-1.5">
                              <span className="text-[13px] text-gray-600">▶ Video attachment</span>
                            </div>
                          )}
                          {tpl.headerType === "DOCUMENT" && tpl.headerMediaUrl && (
                            <a href={tpl.headerMediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-black/5 dark:bg-black/25 rounded-lg px-2.5 py-3 mb-1.5 hover:bg-black/10 transition-colors">
                              <span className="text-[13px] text-gray-600 truncate">📄 {tpl.headerMediaUrl.split("/").pop() || "Document"}</span>
                            </a>
                          )}
                          <p className="text-[14px] text-[#1F2A24] leading-relaxed whitespace-pre-wrap break-words"><WaText text={tpl.body} /></p>
                          {tpl.footer && (
                            <p className="text-[11px] text-gray-500 italic mt-1.5 leading-snug">{tpl.footer}</p>
                          )}
                          <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
                            <span className="text-[10px] text-gray-500">{formatMessageTime(msg.createdAt)}</span>
                            <MessageStatus isSending={isSending} status={msg.status} />
                          </div>
                        </div>
                        {/* Buttons — rows under the message, as WhatsApp draws them */}
                        {tpl.buttons && tpl.buttons.length > 0 && (
                          <div className={`mt-0.5 ${bubbleTone} border rounded-2xl overflow-hidden divide-y divide-black/10 dark:divide-white/10`}>
                            {tpl.buttons.map((btn) => <WaButton key={btn.id} {...btn} />)}
                          </div>
                        )}
                        {/* Carousel — swipeable cards, each a bubble of its own */}
                        {tpl.cards && tpl.cards.length > 0 && (
                          <div className="mt-1 flex gap-2 overflow-x-auto pb-1.5 snap-x max-w-full [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/15 dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
                            {tpl.cards.map((card, ci) => (
                              <div key={ci} className={`snap-start shrink-0 w-[232px] flex flex-col ${bubbleTone} border rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(16,24,20,0.08)]`}>
                                <div className="p-1 pb-0">
                                  {card.mediaType === "IMAGE" && card.mediaUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={card.mediaUrl} alt="" className="w-full h-36 object-cover rounded-xl" />
                                  ) : (
                                    <div className="h-36 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-[12px] text-gray-500">▶ Video</div>
                                  )}
                                </div>
                                <p className="flex-1 px-3 pt-2 pb-2.5 text-[13px] leading-snug text-[#1F2A24] whitespace-pre-wrap break-words">
                                  <WaText text={card.body} />
                                </p>
                                {card.buttons.length > 0 && (
                                  <div className="border-t border-black/10 dark:border-white/10 divide-y divide-black/10 dark:divide-white/10">
                                    {card.buttons.map((b) => <WaButton key={b.id} {...b} />)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* List message — the menu button, then its options */}
                        {tpl.list && (
                          <div className={`mt-0.5 ${bubbleTone} border rounded-2xl overflow-hidden`}>
                            <div className="flex items-center justify-center gap-1.5 py-2 text-[13px] font-semibold text-brand-fg border-b border-black/10 dark:border-white/10">
                              <ListIcon className="w-4 h-4" /> {tpl.list.buttonLabel}
                            </div>
                            <ul className="divide-y divide-black/5 dark:divide-white/5">
                              {tpl.list.rows.map((r, ri) => (
                                <li key={ri} className="px-3.5 py-1.5 leading-snug">
                                  <p className="text-[13px] text-[#1F2A24]"><WaText text={r.title} /></p>
                                  {r.description && <p className="text-[11.5px] text-gray-500"><WaText text={r.description} /></p>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex gap-1 mt-0.5 flex-wrap justify-end">
                            {Object.entries(msg.reactions).map(([emoji, count]) => (
                              <span key={emoji} className="bg-white border border-gray-200 shadow-sm rounded-full px-1.5 py-0.5 flex items-center gap-0.5 leading-none">
                                <span className="text-base leading-none">{emoji}</span>
                                {count > 1 && <span className="text-[11px] text-gray-500 font-medium">{count}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {avatar}
                    </div>
                  );
                }

                // Regular agent message
                return (
                  <div key={mid} data-msg-id={mid} className={`group/msg flex justify-end items-end gap-1.5 ${rowGap}`}>
                    <MessageMenu
                      onReply={() => setReplyingTo({ id: Number(msg.id ?? msg._id), content: msg.content, messageType: msg.messageType, senderType: msg.senderType, mediaUrl: msg.mediaUrl ?? (msg.messageType === "IMAGE" ? msg.content : null) })}
                      copyText={msg.messageType === "TEXT" ? msg.content : null}
                      onDelete={!isSending && !msg.deletedAt && String(msg.senderId) === String(user?.id) ? () => setDeleteTarget({ id: Number(msg.id ?? msg._id) }) : undefined}
                    />
                    <div className={isMediaMsg ? "" : "max-w-[65%] min-w-0"}>
                      {senderChanged && nameLabel}
                      {isMediaMsg ? (
                        <div className={`transition-opacity ${isSending ? "opacity-75" : "opacity-100"}`}>
                          <MessageContent msg={msg} isAgent={true} />
                          <div className="flex justify-end mt-1">
                            <div className={`${bubbleTone} border rounded-xl px-2.5 py-0.5 inline-flex items-center gap-1`}>
                              <span className="text-[10px] text-gray-500">{formatMessageTime(msg.createdAt)}</span>
                              <MessageStatus isSending={isSending} status={msg.status} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className={`msg-bubble ${bubbleTone} border rounded-2xl ${groupStart ? "rounded-tr-md" : ""} px-3.5 pt-2 pb-1.5 shadow-[0_1px_2px_rgba(16,24,20,0.08)] transition-opacity ${isSending ? "opacity-75" : "opacity-100"}`}
                          >
                            {msg.quotedMessage && (() => {
                              const qm = msg.quotedMessage;
                              const qImg = !qm.deletedAt && qm.messageType === "IMAGE" ? (qm.mediaUrl ?? qm.content) : null;
                              return (
                                <div onClick={() => scrollToMessage(qm.id)} className="border-l-2 border-brand/60 pl-2 mb-2 py-0.5 pr-1 bg-white/60 rounded-r-md cursor-pointer hover:bg-white transition-colors">
                                  <p className="text-[10px] font-semibold text-brand-fg leading-tight">
                                    {qm.senderType === "AGENT" ? "You" : customer?.name || "Contact"}
                                  </p>
                                  {qm.deletedAt ? (
                                    <p className="text-[12px] text-gray-400 italic truncate leading-tight">This message was deleted</p>
                                  ) : qImg ? (
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={qImg} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                      <span className="text-[12px] text-gray-500">Photo</span>
                                    </div>
                                  ) : (
                                    <p className="text-[12px] text-gray-500 truncate leading-tight">
                                      {messagePreview(qm)}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                            <MessageContent msg={msg} isAgent={true} />
                            <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
                              <span className="text-[10px] text-gray-500">
                                {formatMessageTime(msg.createdAt)}
                              </span>
                              <MessageStatus
                                isSending={isSending}
                                status={msg.status}
                              />
                            </div>
                          </div>
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className="flex gap-1 mt-0.5 flex-wrap justify-end">
                              {Object.entries(msg.reactions).map(([emoji, count]) => (
                                <span key={emoji} className="bg-white border border-gray-200 shadow-sm rounded-full px-1.5 py-0.5 flex items-center gap-0.5 leading-none">
                                  <span className="text-base leading-none">{emoji}</span>
                                  {count > 1 && <span className="text-[11px] text-gray-500 font-medium">{count}</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {avatar}
                  </div>
                );
              })()
            );

            return (
              <Fragment key={mid}>
                {newDay && (
                  <div className="flex justify-center pt-3 pb-1">
                    <span className="text-[11px] font-medium text-gray-500 bg-white border border-[#D6DED9] rounded-full px-3 py-0.5 shadow-sm">
                      {dayLabel(msg.createdAt)}
                    </span>
                  </div>
                )}
                {row}
              </Fragment>
            );
          })}

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="flex justify-end">
              <div className="mt-3 bg-[#D9FDD3] border border-[#BFE6B6] rounded-2xl rounded-tr-md px-3.5 py-2">
                <span className="text-[12px] text-brand-fg/60 italic">
                  {typingUsers.join(", ")}{" "}
                  {typingUsers.length === 1 ? "is" : "are"} typing…
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
          {showScrollDown && (
            <button
              onClick={() => { messagesContainerRef.current?.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: "smooth" }); setUnreadCount(0); }}
              className="absolute bottom-5 right-7 z-20 w-11 h-11 rounded-full bg-white border border-gray-200 shadow-md flex items-center justify-center text-brand-fg hover:bg-brand hover:text-white hover:border-brand transition-all cursor-pointer"
            >
              <ChevronDown className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-semibold flex items-center justify-center leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>
      ))}

      {/* Input bar — hidden while preview panel is open */}
      {pendingFiles.length === 0 && (
        <div className="relative z-10 shrink-0 bg-white border-t border-gray-100">
          {/* Replying-to preview bar */}
          {replyingTo && (
            <div className="flex items-center gap-3 px-4 pt-2.5 pb-1 border-b border-gray-100">
              <div className="flex-1 border-l-2 border-brand pl-2 min-w-0">
                <p className="text-[11px] font-semibold text-brand-fg leading-tight">
                  {replyingTo.senderType === "AGENT" ? "You" : customer?.name || "Contact"}
                </p>
                {replyingTo.messageType === "IMAGE" && replyingTo.mediaUrl ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={replyingTo.mediaUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                    <span className="text-[12px] text-gray-500">Photo</span>
                  </div>
                ) : (
                  <p className="text-[12px] text-gray-500 truncate leading-tight">
                    {messagePreview(replyingTo)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 24h window closed notice */}
          {windowClosed && (
            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
              <Clock className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <p className="text-[12px] text-red-500 font-medium">
                {conversation?.lastCustomerMessageAt
                  ? "24-hour messaging window closed — send an approved template to restart the conversation."
                  : "This contact hasn't messaged you yet — start the conversation with an approved template."}
              </p>
            </div>
          )}

          <div className="flex items-end gap-3 px-4 py-3">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFileSelect}
            />
            <div className={`flex-1 flex items-end gap-3 rounded-2xl px-4 py-2.5 border transition-colors ${
              windowClosed
                ? "bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed"
                : "bg-gray-50 border-gray-200"
            }`}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || windowClosed}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0 mb-0.5"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={windowClosed ? "" : message}
                disabled={windowClosed}
                onChange={(e) => {
                  if (windowClosed) return;
                  setMessage(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;

                  // The customer sees "typing…" while an agent writes a
                  // reply — refreshed every 20s (WhatsApp shows it for 25s).
                  if (e.target.value.trim() && Date.now() - customerTypingSentRef.current > 20_000) {
                    customerTypingSentRef.current = Date.now();
                    apiSendTyping(id).catch(() => {});
                  }

                  if (user?.username) {
                    emitTypingStart(id, user.username);
                    if (typingTimerRef.current)
                      clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => {
                      emitTypingStop(id, user.username!);
                      typingTimerRef.current = null;
                    }, 2000);
                  }
                }}
                onBlur={() => { handleTypingStop(); }}
                onKeyDown={(e) => {
                  if (windowClosed) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                    if (textareaRef.current)
                      textareaRef.current.style.height = "auto";
                  }
                }}
                placeholder={windowClosed ? "Messaging disabled — 24h window closed" : "Type a message..."}
                className="flex-1 text-[14px] text-gray-700 placeholder:text-gray-400 outline-none bg-transparent resize-none overflow-hidden leading-[1.5] py-0.5 max-h-40 disabled:cursor-not-allowed"
              />

              <div className="relative shrink-0">
                <button
                  ref={emojiButtonRef}
                  type="button"
                  disabled={windowClosed}
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className={`text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer mb-0.5 ${showEmojiPicker ? "text-brand-fg" : ""}`}
                >
                  <Smile className="w-4 h-4" />
                </button>
                {showEmojiPicker && (
                  <div ref={emojiPickerRef} className="absolute bottom-8 right-0 z-50 emoji-picker-green">
                    <Suspense fallback={null}>
                      <EmojiPicker
                        theme={resolvedTheme ?? "light"}
                        onEmojiSelect={(emoji: { native: string }) => {
                          const ta = textareaRef.current;
                          if (!ta) return;
                          const start = ta.selectionStart ?? message.length;
                          const end = ta.selectionEnd ?? message.length;
                          const next = message.slice(0, start) + emoji.native + message.slice(end);
                          setMessage(next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            const pos = start + emoji.native.length;
                            ta.setSelectionRange(pos, pos);
                          });
                        }}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
            </div>

            {/* Template button — always accessible; RE_ENGAGEMENT when window is closed */}
            <button
              type="button"
              onClick={() => windowClosed ? setReengagementOpen(true) : setTemplatePickerOpen(true)}
              title={windowClosed ? "Send an approved template" : "Insert template"}
              className={`flex items-center gap-1.5 text-[12px] font-medium border rounded-xl px-2.5 py-2 transition-colors cursor-pointer shrink-0 ${
                windowClosed
                  ? "text-red-600 bg-red-50 border-red-300 hover:bg-red-100 hover:border-red-400"
                  : "text-gray-500 hover:text-brand-fg hover:bg-brand-100 border-gray-200 hover:border-brand/30"
              }`}
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Template</span>
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={!message.trim() || sending || windowClosed}
              className="flex items-center gap-2 bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl transition-colors cursor-pointer shrink-0"
            >
              Send
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {templatePickerOpen && (
        <TemplatePickerModal
          conversationId={id}
          category="GENERAL"
          customerName={customer?.name ?? "Customer"}
          agentName={user?.username ?? "Agent"}
          onClose={() => setTemplatePickerOpen(false)}
          onSent={() => setTemplatePickerOpen(false)}
          beforeSend={confirmOwnership}
          guardedSend={guardedSend}
          optOut={optOut}
        />
      )}
      {reengagementOpen && (
        <TemplatePickerModal
          conversationId={id}
          category="RE_ENGAGEMENT"
          customerName={customer?.name ?? "Customer"}
          agentName={user?.username ?? "Agent"}
          onClose={() => setReengagementOpen(false)}
          onSent={() => setReengagementOpen(false)}
          beforeSend={confirmOwnership}
          guardedSend={guardedSend}
          optOut={optOut}
        />
      )}
      {ownerPrompt && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4" onClick={() => answerOwnerPrompt(false)}>
          <div role="alertdialog" aria-modal="true" className="bg-white rounded-2xl shadow-2xl w-[400px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">This chat is assigned to {ownerPrompt}</h3>
            <p className="text-[13px] text-gray-500 mb-5">
              {ownerPrompt} is handling this customer. Your reply will go out in their chat, and they&apos;ll see it. You won&apos;t be asked again for this chat.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => answerOwnerPrompt(false)} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={() => answerOwnerPrompt(true)} className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5840] cursor-pointer">
                Reply anyway
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center px-4" onClick={() => !deletingMsg && setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1.5">Delete this message?</h3>
            <p className="text-[13px] text-gray-500 mb-5">
              This removes it from the chat here, but it can't be recalled from WhatsApp itself — the customer's copy stays as-is.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingMsg}
                className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteMessage}
                disabled={deletingMsg}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                {deletingMsg && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
    {showInfo && (
      // Full-screen over the chat on phones; a side column from md up.
      <div className="absolute inset-0 z-30 flex md:static md:z-auto">
        <ContactPanel
          conversationId={id}
          refreshKey={messages.length}
          onClose={() => setShowInfo(false)}
          onJumpToMessage={(msgId) => {
            const row = document.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`);
            if (!row) return false;
            scrollToMessage(msgId);
            return true;
          }}
        />
      </div>
    )}
    </div>
  );
}
