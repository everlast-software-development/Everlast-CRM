"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Upload,
  TrendingDown,
  Pause,
  Play,
  Loader2,
  Trash2,
  Hourglass,
  Send,
  AlertCircle,
} from "lucide-react";
import type { Campaign, CampaignCategory } from "@/types";
import {
  apiGetCampaigns,
  apiGetActiveCampaignProgress,
  apiCancelCampaign,
  apiPauseCampaign,
  apiResumeCampaign,
  apiBulkDeleteCampaigns,
  apiSubmitCampaign,
  } from "@/lib/api";
import { useCampaignReview } from "@/components/CampaignApprovalDialogs";
import { getSocket } from "@/lib/socket";
import { useToast } from "@/components/ui/toast";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";
import { NoAccess } from "@/components/NoAccess";
import CampaignCategoryBadge from "@/components/CampaignCategoryBadge";
import { CAMPAIGN_CATEGORIES, CAMPAIGN_CATEGORY_LABELS } from "@/lib/campaignCategories";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function personName(p: { name: string | null; username: string } | null | undefined): string {
  return p ? p.name || p.username : "someone";
}

const STAT_COLORS: Record<string, string> = {
  COMPLETED: "bg-green-50 text-green-700",
  RUNNING: "bg-blue-50 text-blue-700",
  PAUSED: "bg-orange-50 text-orange-600",
  SCHEDULED: "bg-amber-50 text-amber-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  DRAFT: "bg-gray-100 text-gray-500",
};

// The short label on a paused card. RATE_LIMIT and CONNECTION resume by
// themselves at resumeAt; the rest wait for a person.
const PAUSE_LABELS: Partial<Record<NonNullable<Campaign["pauseReason"]>, string>> = {
  QUIET_HOURS: "Quiet hours",
  RATE_LIMIT: "Slowed down",
  CONNECTION: "Connection lost",
  TEMPLATE_UNAVAILABLE: "Template unavailable",
  QUALITY: "Quality dropped",
};

// The sentence after "N / M sent —" explaining why, and what happens next.
function pauseExplanation(c: Campaign): string {
  const detail = c.pauseDetail ? ` (${c.pauseDetail})` : "";
  switch (c.pauseReason) {
    case "QUIET_HOURS":
      return "paused for quiet hours, resumes automatically when they end.";
    case "SEND_ERROR":
      return `paused because Meta refused the send${detail}. Fix it, then Resume — nobody left was marked failed.`;
    case "NUMBER_INACTIVE":
      return "paused because the WhatsApp number can't send.";
    case "RATE_LIMIT":
      return c.resumeAt
        ? `Meta asked us to slow down — resumes by itself at ${formatClock(c.resumeAt)}.`
        : "Meta asked us to slow down — resumes by itself shortly.";
    case "CONNECTION":
      return c.resumeAt
        ? `couldn't reach WhatsApp — retrying at ${formatClock(c.resumeAt)}.`
        : "couldn't reach WhatsApp — retrying shortly.";
    case "TEMPLATE_UNAVAILABLE":
      return `paused because the template can't be used${detail}. Resume once it's available again.`;
    case "QUALITY":
      return `number quality dropped${detail}. Sending stopped to protect the number — Resume once it recovers.`;
    default:
      return "paused before completing.";
  }
}

// ── Running Campaign Card ─────────────────────────────────────────────────────

function RunningCard({
  campaign,
  onCancel,
  onPause,
  pausing,
  canControl,
}: {
  campaign: Campaign;
  onCancel: (id: number) => void;
  onPause: (id: number) => void;
  pausing: boolean;
  canControl: boolean;
}) {
  const { sentCount, failedCount, totalRecipients, startedAt, name } = campaign;
  const done = sentCount + failedCount;
  const pct = totalRecipients > 0 ? Math.round((done / totalRecipients) * 100) : 0;
  // Matches the backend's 5-way send concurrency — effective per-recipient
  // wall time, not a per-message throttle. Keep in sync with the estimate in
  // campaigns/new/page.tsx if that concurrency setting ever changes.
  const remaining = totalRecipients > 0 ? ((totalRecipients - done) * 0.3) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-[11px] font-bold tracking-wider text-green-600 uppercase">Sending Now</span>
          <span className="text-[13px] font-semibold text-gray-800">{name}</span>
          <CampaignCategoryBadge category={campaign.category} />
          {startedAt && (
            <span className="text-[12px] text-gray-400">Started {timeAgo(startedAt)}</span>
          )}
        </div>
        {canControl && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPause(campaign.id)}
              disabled={pausing}
              className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-3 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pausing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
              Pause
            </button>
            <button
              onClick={() => onCancel(campaign.id)}
              className="text-[12px] font-medium text-red-500 hover:text-red-600 border border-red-200 hover:border-red-300 px-3 py-1 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className="absolute left-0 top-0 h-full bg-brand rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[12px] text-gray-500 mb-4">
        <span>{done} / {totalRecipients} sent</span>
        {remaining > 0 && <span>≈ {formatDuration(remaining)} left</span>}
      </div>

      <div className="flex items-center gap-6">
        {[
          { label: "Sent", value: sentCount },
          { label: "Delivered", value: campaign.deliveredCount ?? 0 },
          { label: "Read", value: campaign.readCount ?? 0 },
          { label: "Replied", value: campaign.repliedCount ?? 0 },
          { label: "Failed", value: failedCount },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <span className="text-[22px] font-bold leading-none text-gray-800">{value}</span>
            <span className="text-[11px] text-gray-400 mt-0.5">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Paused Card ────────────────────────────────────────────────────────────

function PausedCard({
  campaign,
  onCancel,
  onResume,
  resuming,
  canControl,
}: {
  campaign: Campaign;
  onCancel: (id: number) => void;
  onResume: (id: number) => void;
  resuming: boolean;
  canControl: boolean;
}) {
  const { sentCount, failedCount, totalRecipients, name } = campaign;
  const done = sentCount + failedCount;
  const pct = totalRecipients > 0 ? Math.round((done / totalRecipients) * 100) : 0;

  return (
    <div className="bg-white border border-orange-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Pause className="w-3.5 h-3.5 text-orange-500" />
          <span className="text-[11px] font-bold tracking-wider text-orange-600 uppercase">
            {(campaign.pauseReason && PAUSE_LABELS[campaign.pauseReason]) ?? "Paused"}
          </span>
          <span className="text-[13px] font-semibold text-gray-800">{name}</span>
          <CampaignCategoryBadge category={campaign.category} />
        </div>
        {canControl && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onResume(campaign.id)}
              disabled={resuming}
              className="flex items-center gap-1 text-[12px] font-semibold text-brand-fg hover:text-[#2f5540] border border-brand/30 hover:border-brand/50 px-3 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resuming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Resume
            </button>
            <button
              onClick={() => onCancel(campaign.id)}
              className="text-[12px] font-medium text-red-500 hover:text-red-600 border border-red-200 hover:border-red-300 px-3 py-1 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div
          className="absolute left-0 top-0 h-full bg-orange-300 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[12px] text-gray-500">
        {done} / {totalRecipients} sent — {pauseExplanation(campaign)}
      </div>
    </div>
  );
}

// ── Scheduled Card ─────────────────────────────────────────────────────────

function ScheduledCard({ campaign, onCancel, canControl }: { campaign: Campaign; onCancel: (id: number) => void; canControl: boolean }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-4 flex items-center gap-4">
      <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
        <Clock className="w-4.5 h-4.5 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[14px] font-semibold text-gray-800 truncate">{campaign.name}</p>
          <CampaignCategoryBadge category={campaign.category} />
        </div>
        <p className="text-[12px] text-gray-400">
          Scheduled · {campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : "—"} · {campaign.totalRecipients} recipients
        </p>
      </div>
      {canControl && (
        <button
          onClick={() => onCancel(campaign.id)}
          className="text-[12px] font-medium text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors shrink-0 cursor-pointer"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ── Awaiting Approval Card ────────────────────────────────────────────────────

// Submitted by someone without campaign:send. Approving is the send, so only
// reviewers get the buttons; everyone else sees that it is waiting.
function PendingApprovalCard({
  campaign,
  canReview,
  busy,
  onOpen,
  onApprove,
  onReject,
}: {
  campaign: Campaign;
  canReview: boolean;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-4 flex items-center gap-4">
      <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
        <Hourglass className="w-4 h-4 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onOpen}
            className="text-[14px] font-semibold text-gray-800 truncate hover:underline cursor-pointer"
          >
            {campaign.name}
          </button>
          <CampaignCategoryBadge category={campaign.category} />
        </div>
        <p className="text-[12px] text-gray-400">
          {campaign.template?.name ?? "—"} · {campaign.totalRecipients} recipient{campaign.totalRecipients !== 1 ? "s" : ""} ·{" "}
          {campaign.scheduledAt ? `Proposed ${formatDateTime(campaign.scheduledAt)}` : "Sends when approved"}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Submitted by {personName(campaign.submittedBy)}
          {campaign.submittedAt && ` · ${formatDateTime(campaign.submittedAt)}`}
        </p>
      </div>
      {canReview ? (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onReject}
            disabled={busy}
            className="text-[12px] font-medium text-red-500 hover:text-red-600 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            disabled={busy}
            className="flex items-center gap-1 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5540] px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve
          </button>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full shrink-0">
          <Clock className="w-3 h-3" />
          Waiting for an admin
        </span>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [pausingIds, setPausingIds] = useState<Set<number>>(new Set());
  const [resumingIds, setResumingIds] = useState<Set<number>>(new Set());
  // Multi-select for bulk delete — spans the Drafts and Sent (completed/
  // cancelled) sections, the only deletable states.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | CampaignCategory>("ALL");
  // From the server's permission list (see CurrentUserProvider), so the page
  // shows exactly the actions the API will accept. Two separate capabilities:
  // building campaigns, and stopping or removing them.
  const { ready: userReady, can, me } = useCurrentUser();
  const canWrite = can("campaign:write");
  const canControl = can("campaign:control");
  // Sending and approving are the same capability: without it, a finished
  // draft is submitted for an admin to approve instead of sent.
  const canSend = can("campaign:send");
  const [submittingIds, setSubmittingIds] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    apiGetCampaigns()
      .then((res) => setCampaigns(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const review = useCampaignReview(load);

  // Lightweight poll target — only queries active (RUNNING/PAUSED) campaigns'
  // counters, not the full history + delivered/read/replied joins that
  // apiGetCampaigns does. Never rolls progress backward on a RUNNING campaign.
  const pollLoad = useCallback(() => {
    apiGetActiveCampaignProgress()
      .then((res) => {
        const activeMap = new Map(res.data.map((c) => [c.id, c]));
        let missingTerminal = false;
        setCampaigns((prev) =>
          prev.map((c) => {
            if (c.status !== "RUNNING" && c.status !== "PAUSED") return c;
            const fresh = activeMap.get(c.id);
            if (!fresh) {
              // No longer active — it finished/was cancelled between polls.
              // The lightweight endpoint doesn't carry final delivered/read/
              // replied numbers, so fall back to a full reload for this tick.
              missingTerminal = true;
              return c;
            }
            return {
              ...c,
              status: fresh.status,
              sentCount: Math.max(c.sentCount, fresh.sentCount),
              failedCount: Math.max(c.failedCount, fresh.failedCount),
              totalRecipients: fresh.totalRecipients,
            };
          })
        );
        if (missingTerminal) load();
      })
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    load();
    const socket = getSocket();
    const refresh = () => load();
    const onProgress = (data: { campaignId: number; sentCount: number; failedCount: number; totalRecipients: number }) => {
      // The backend now sends up to 5 recipients concurrently, so their
      // progress events can arrive out of commit-order — never let a
      // late-but-stale event visibly walk the counters backward.
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === data.campaignId
            ? {
                ...c,
                sentCount: Math.max(c.sentCount, data.sentCount),
                failedCount: Math.max(c.failedCount, data.failedCount),
                totalRecipients: data.totalRecipients,
              }
            : c
        )
      );
    };
    socket.on("campaign.started", refresh);
    socket.on("campaign.progress", onProgress);
    socket.on("campaign.completed", refresh);
    socket.on("campaign.cancelled", refresh);
    socket.on("campaign.paused", refresh);
    // Approval moves: a draft enters/leaves "Awaiting approval", or an approval
    // starts the send — keep every open copy of this page in step.
    socket.on("campaign.submitted", refresh);
    socket.on("campaign.approved", refresh);
    socket.on("campaign.rejected", refresh);
    return () => {
      socket.off("campaign.started", refresh);
      socket.off("campaign.progress", onProgress);
      socket.off("campaign.completed", refresh);
      socket.off("campaign.cancelled", refresh);
      socket.off("campaign.paused", refresh);
      socket.off("campaign.submitted", refresh);
      socket.off("campaign.approved", refresh);
      socket.off("campaign.rejected", refresh);
    };
  }, [load]);

  // Poll while any campaign is running — catches missed socket events. 1.5s
  // instead of the old 3s since sends now complete several times faster with
  // the backend's concurrent-send batching, so a 3s gap felt laggy/stale.
  const hasRunning = campaigns.some((c) => c.status === "RUNNING");
  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(pollLoad, 1500);
    return () => clearInterval(interval);
  }, [hasRunning, pollLoad]);

  const handleCancel = async (id: number) => {
    try {
      await apiCancelCampaign(id);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel campaign.");
    }
  };

  const handlePause = async (id: number) => {
    setPausingIds((prev) => new Set(prev).add(id));
    try {
      await apiPauseCampaign(id);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't pause campaign.");
    } finally {
      setPausingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleResume = async (id: number) => {
    setResumingIds((prev) => new Set(prev).add(id));
    try {
      await apiResumeCampaign(id);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't resume campaign.");
    } finally {
      setResumingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // The server re-checks the template and number here, so a 409 (template
  // paused, number inactive…) comes back with a message worth showing as is.
  const handleSubmitForApproval = async (id: number) => {
    setSubmittingIds((prev) => new Set(prev).add(id));
    try {
      await apiSubmitCampaign(id);
      toast.success("Submitted for approval");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit campaign.");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Without campaign:send, the server only lets you change or submit drafts
  // you created — offer exactly that.
  const mayEditDraft = (c: Campaign) => canWrite && (canSend || c.createdById === me?.id);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectMany = (ids: number[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Only offer chips for categories that actually have campaigns.
  const presentCategories = CAMPAIGN_CATEGORIES.filter((cat) => campaigns.some((c) => c.category === cat.value));
  const visible = categoryFilter === "ALL" ? campaigns : campaigns.filter((c) => c.category === categoryFilter);

  const handleExport = () => {
    const completed = visible.filter((c) => c.status === "COMPLETED");
    const rows = [
      ["Name", "Status", "Category", "Recipients", "Sent", "Failed", "Delivered", "Read", "Replied", "Started", "Completed"],
      ...completed.map((c) => [
        c.name,
        c.status,
        CAMPAIGN_CATEGORY_LABELS[c.category] ?? c.category,
        c.totalRecipients,
        c.sentCount,
        c.failedCount,
        c.deliveredCount ?? 0,
        c.readCount ?? 0,
        c.repliedCount ?? 0,
        c.startedAt ? new Date(c.startedAt).toISOString() : "",
        c.completedAt ? new Date(c.completedAt).toISOString() : "",
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaigns-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const running = visible.filter((c) => c.status === "RUNNING");
  const paused = visible.filter((c) => c.status === "PAUSED");
  const scheduled = visible.filter((c) => c.status === "SCHEDULED");
  const pending = visible.filter((c) => c.status === "PENDING_APPROVAL");
  const drafts = visible.filter((c) => c.status === "DRAFT");
  const sent = visible.filter((c) => c.status === "COMPLETED" || c.status === "CANCELLED");

  // Only deletable campaigns can be selected; prune the selection to what's
  // actually on screen so the counter never counts rows that reloaded away.
  const deletableIds = useMemo(
    () => new Set([...drafts, ...sent].map((c) => c.id)),
    [drafts, sent]
  );
  const selectedValidIds = useMemo(
    () => [...selectedIds].filter((id) => deletableIds.has(id)),
    [selectedIds, deletableIds]
  );
  const selectedCount = selectedValidIds.length;
  const sentIds = sent.map((c) => c.id);
  const draftIds = drafts.map((c) => c.id);
  const allSentSelected = sentIds.length > 0 && sentIds.every((id) => selectedIds.has(id));
  const allDraftsSelected = draftIds.length > 0 && draftIds.every((id) => selectedIds.has(id));

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    setDeleting(true);
    try {
      const res = await apiBulkDeleteCampaigns(selectedValidIds);
      setCampaigns((prev) => prev.filter((c) => !selectedValidIds.includes(c.id)));
      clearSelection();
      setConfirmOpen(false);
      toast.success(res.message ?? `Deleted ${res.deletedCount} campaign${res.deletedCount !== 1 ? "s" : ""}.`);
      if (res.skippedCount > 0) {
        toast.info(`${res.skippedCount} couldn't be deleted (active or scheduled — cancel them first).`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete campaigns.");
    } finally {
      setDeleting(false);
    }
  };

  if (!userReady) return <PageSpinner />;
  if (!can("campaign:read")) return <NoAccess what="campaigns" />;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <svg className="w-10 h-10 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-gray-900">Campaigns</h1>
            <p className="text-[13px] text-gray-400 mt-0.5">
              {sent.filter(c => c.status === "COMPLETED").length} sent
              {paused.length > 0 && ` · ${paused.length} paused`}
              {pending.length > 0 && ` · ${pending.length} awaiting approval`}
              {scheduled.length > 0 && ` · ${scheduled.length} scheduled`}
              {drafts.length > 0 && ` · ${drafts.length} draft${drafts.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Export
            </button>
            {canWrite && (
              <button
                onClick={() => router.push("/campaigns/new")}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5540] px-4 py-2 rounded-xl transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                New campaign
              </button>
            )}
          </div>
        </div>

        {/* Category filter */}
        {(presentCategories.length > 1 || categoryFilter !== "ALL") && (
          <div className="flex flex-wrap gap-2 -mt-4">
            {[{ value: "ALL" as const, label: "All" }, ...presentCategories].map((cat) => {
              const active = categoryFilter === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategoryFilter(cat.value)}
                  className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? "bg-brand text-white border-brand"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Awaiting approval — first, since for an admin it's the to-do list */}
        {pending.length > 0 && (
          <div>
            <p className="text-[11px] font-bold tracking-wider text-amber-600 uppercase mb-3">
              Awaiting approval · {pending.length}
            </p>
            <div className="space-y-2">
              {pending.map((c) => (
                <PendingApprovalCard
                  key={c.id}
                  campaign={c}
                  canReview={canSend}
                  busy={review.reviewing}
                  onOpen={() => router.push(`/campaigns/${c.id}`)}
                  onApprove={() => review.startApprove(c)}
                  onReject={() => review.startReject(c)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Running */}
        {running.length > 0 && (
          <div className="space-y-3">
            {running.map((c) => (
              <RunningCard key={c.id} campaign={c} onCancel={handleCancel} onPause={handlePause} pausing={pausingIds.has(c.id)} canControl={canControl} />
            ))}
          </div>
        )}

        {/* Paused */}
        {paused.length > 0 && (
          <div className="space-y-3">
            {paused.map((c) => (
              <PausedCard key={c.id} campaign={c} onCancel={handleCancel} onResume={handleResume} resuming={resumingIds.has(c.id)} canControl={canControl} />
            ))}
          </div>
        )}

        {/* Scheduled */}
        {scheduled.length > 0 && (
          <div className="space-y-2">
            {scheduled.map((c) => (
              <ScheduledCard key={c.id} campaign={c} onCancel={handleCancel} canControl={canControl} />
            ))}
          </div>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              {canControl && (
                <input
                  type="checkbox"
                  checked={allDraftsSelected}
                  onChange={(e) => toggleSelectMany(draftIds, e.target.checked)}
                  className="rounded border-gray-300 accent-brand cursor-pointer"
                  title="Select all drafts"
                />
              )}
              <p className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">Drafts</p>
            </div>
            <div className="space-y-2">
              {drafts.map((c) => {
                const isSel = selectedIds.has(c.id);
                // Rejected = an admin sent it back; the reason stays until it's resubmitted.
                const rejected = !!c.rejectionReason;
                const editable = mayEditDraft(c);
                return (
                <div
                  key={c.id}
                  className={`bg-white border rounded-2xl transition-colors ${
                    isSel
                      ? "border-brand ring-1 ring-brand bg-brand-50"
                      : rejected
                      ? "border-red-200"
                      : "border-dashed border-gray-200"
                  }`}
                >
                <div className="p-4 flex items-center gap-4">
                  {canControl && (
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded border-gray-300 accent-brand cursor-pointer shrink-0"
                    />
                  )}
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-[14px] font-semibold text-gray-800 truncate">{c.name}</p>
                      <CampaignCategoryBadge category={c.category} />
                    </div>
                    <p className="text-[12px] text-gray-400">
                      {rejected ? "Sent back" : "Draft"} · {c.template?.name ?? "—"} · {c.totalRecipients} recipient{c.totalRecipients !== 1 ? "s" : ""}
                      {c.scheduledAt && ` · Proposed ${formatDateTime(c.scheduledAt)}`}
                    </p>
                  </div>
                  {editable && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => router.push(`/campaigns/new?draft=${c.id}`)}
                        className="text-[12px] font-medium text-brand-fg hover:text-[#2f5540] border border-brand/20 hover:border-brand/40 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        {rejected && !canSend ? "Edit & resubmit" : "Continue editing"}
                      </button>
                      {/* Straight to review, for a draft that's already finished.
                          Admins send from the wizard instead. */}
                      {!canSend && (
                        <button
                          onClick={() => handleSubmitForApproval(c.id)}
                          disabled={submittingIds.has(c.id) || c.totalRecipients === 0}
                          title={c.totalRecipients === 0 ? "Add recipients before submitting" : undefined}
                          className="flex items-center gap-1 text-[12px] font-semibold text-white bg-brand hover:bg-[#2f5540] px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {submittingIds.has(c.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {rejected ? "Resubmit" : "Submit"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {rejected && (
                  <div className="mx-4 mb-4 -mt-1 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-[12px] text-red-700 min-w-0">
                      <p className="font-semibold">
                        Rejected by {personName(c.reviewedBy)}
                        {c.reviewedAt && <span className="font-normal text-red-500"> · {formatDateTime(c.reviewedAt)}</span>}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words">{c.rejectionReason}</p>
                    </div>
                  </div>
                )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {campaigns.length === 0 && (
          <div className="text-center py-24">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-gray-700">No campaigns yet</p>
            <p className="text-[13px] text-gray-400 mt-1 mb-5">
              {canWrite
                ? "Send your first WhatsApp campaign to your contacts."
                : "No campaigns have been sent yet. An admin or the marketing team can create one."}
            </p>
            {canWrite && (
              <button
                onClick={() => router.push("/campaigns/new")}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5540] px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                New campaign
              </button>
            )}
          </div>
        )}

        {/* Sent table */}
        {sent.length > 0 && (
          <div>
            <p className="text-[11px] font-bold tracking-wider text-gray-400 uppercase mb-3">Sent</p>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    {canControl && (
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allSentSelected}
                          onChange={(e) => toggleSelectMany(sentIds, e.target.checked)}
                          className="rounded border-gray-300 accent-brand cursor-pointer align-middle"
                          title="Select all"
                        />
                      </th>
                    )}
                    <th className="text-left px-5 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Campaign</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Sent</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Recipients</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Delivered</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Read</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Replied</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Failed</th>
                    <th className="text-right px-5 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sent.map((c) => {
                    const replyRate = c.sentCount > 0 ? (c.repliedCount ?? 0) / c.sentCount : 0;
                    const lowEngagement = c.status === "COMPLETED" && replyRate < 0.1 && c.sentCount > 5;
                    const isSel = selectedIds.has(c.id);
                    return (
                      <tr key={c.id} className={`transition-colors cursor-pointer ${isSel ? "bg-brand-50" : "hover:bg-gray-50"}`} onClick={() => router.push(`/campaigns/${c.id}`)}>
                        {canControl && (
                          <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={() => toggleSelect(c.id)}
                              className="rounded border-gray-300 accent-brand cursor-pointer align-middle"
                            />
                          </td>
                        )}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-800">{c.name}</p>
                            <CampaignCategoryBadge category={c.category} />
                          </div>
                          {c.template && (
                            <p className="text-[11px] text-gray-400">{c.template.name}</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-gray-500">
                          {c.startedAt ? formatDateTime(c.startedAt) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right text-gray-700 font-medium">{c.totalRecipients}</td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-gray-700">{c.deliveredCount ?? 0}</span>
                          {c.sentCount > 0 && (
                            <span className="text-gray-400 text-[11px] ml-1">
                              · {Math.round(((c.deliveredCount ?? 0) / c.sentCount) * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-gray-700">{c.readCount ?? 0}</span>
                          {c.sentCount > 0 && (
                            <span className="text-gray-400 text-[11px] ml-1">
                              · {Math.round(((c.readCount ?? 0) / c.sentCount) * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-gray-700">{c.repliedCount ?? 0}</span>
                          {c.sentCount > 0 && (
                            <span className="text-gray-400 text-[11px] ml-1">
                              · {Math.round(replyRate * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={c.failedCount > 0 ? "text-red-500 font-medium" : "text-gray-700"}>{c.failedCount}</span>
                          {c.totalRecipients > 0 && c.failedCount > 0 && (
                            <span className="text-gray-400 text-[11px] ml-1">
                              · {Math.round((c.failedCount / c.totalRecipients) * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {lowEngagement ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-50 text-amber-600 px-2 py-1 rounded-full">
                              <TrendingDown className="w-3 h-3" />
                              Low engagement
                            </span>
                          ) : c.status === "COMPLETED" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-green-50 text-green-600 px-2 py-1 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              Completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
                              <XCircle className="w-3 h-3" />
                              Cancelled
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Floating bulk-action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white dark:text-gray-50 rounded-2xl shadow-xl pl-5 pr-3 py-2.5">
          <span className="text-[13px] font-medium">
            {selectedCount} selected
          </span>
          <button
            onClick={clearSelection}
            className="text-[12px] font-medium text-gray-300 hover:text-white dark:hover:text-gray-50 px-2 py-1 rounded-lg transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-1.5 text-[13px] font-semibold bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded-xl transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmOpen && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-gray-900">
                  Delete {selectedCount} campaign{selectedCount !== 1 ? "s" : ""}?
                </h3>
                <p className="text-[13px] text-gray-500 mt-1">
                  This permanently removes {selectedCount === 1 ? "it" : "them"} and all associated recipient records. This can&apos;t be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
                className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Approve / reject / over-limit confirm */}
      {review.dialogs}
    </div>
  );
}
