"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { CampaignCapacity } from "@/types";
import { ApiError, apiApproveCampaign, apiGetCampaignCapacity, apiRejectCampaign } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The numbers behind a 409 OVER_MESSAGING_LIMIT (send or approve), or null for
 * any other error. The server refuses the first try when the campaign needs
 * more people than Meta's daily limit has left; the caller shows these numbers
 * and retries with { confirmOverLimit: true }.
 */
export function overLimitDetails(err: unknown): CampaignCapacity | null {
  if (err instanceof ApiError && err.status === 409 && err.code === "OVER_MESSAGING_LIMIT" && err.details) {
    return err.details as unknown as CampaignCapacity;
  }
  return null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Closes only through its own buttons, never by a click outside it.
function Modal({ children }: { onClose: () => void; busy: boolean; children: ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ── Over-limit confirm ───────────────────────────────────────────────────────

// Past the limit Meta rejects the rest one by one, and the campaign pauses
// until the rolling 24 hours frees up room — so this is a real choice, not a
// formality.
export function OverLimitDialog({
  capacity,
  actionLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  capacity: CampaignCapacity;
  actionLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const remaining = capacity.remaining ?? 0;
  return (
    <Modal onClose={onCancel} busy={busy}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-gray-900">Over today&apos;s messaging limit</h3>
          <p className="text-[13px] text-gray-500 mt-1">
            This campaign needs <span className="font-semibold text-gray-700">{capacity.needed.toLocaleString()}</span> people,
            but the number can only reach <span className="font-semibold text-gray-700">{remaining.toLocaleString()}</span> more today.
          </p>
        </div>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 space-y-1.5 text-[12px]">
        {[
          { label: "Needed", value: capacity.needed.toLocaleString() },
          { label: "Left today", value: remaining.toLocaleString() },
          { label: "Daily limit", value: capacity.limit != null ? capacity.limit.toLocaleString() : "—" },
          { label: "Used in the last 24h", value: capacity.usedLast24h.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="text-gray-500">{label}</span>
            <span className="font-medium text-gray-800">{value}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-gray-500 mb-5">
        Messages past the limit will fail, and the campaign pauses until the 24-hour window frees up room.
        Consider splitting it into smaller batches across days.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
        >
          Go back
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}

// ── Reject with a reason ─────────────────────────────────────────────────────

// The reason is required: it is what the submitter reads on their draft to
// know what to fix before resubmitting.
export function RejectReasonDialog({
  campaignName,
  busy,
  onCancel,
  onConfirm,
}: {
  campaignName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <Modal onClose={onCancel} busy={busy}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
          <XCircle className="w-5 h-5 text-red-500" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-gray-900">Reject “{campaignName}”?</h3>
          <p className="text-[13px] text-gray-500 mt-1">
            It goes back to drafts with your reason, so whoever submitted it can fix it and resubmit.
          </p>
        </div>
      </div>
      <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Reason</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
        rows={3}
        placeholder="e.g. Wrong audience — exclude patients seen this month."
        className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(trimmed)}
          disabled={busy || !trimmed}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
          Reject
        </button>
      </div>
    </Modal>
  );
}

// ── Approve ──────────────────────────────────────────────────────────────────

/** What the approve/reject dialogs need — both Campaign and PendingApproval fit. */
export interface ReviewTarget {
  id: number;
  name: string;
  totalRecipients: number;
  scheduledAt?: string | null;
}

// Approving IS the send, so it gets a confirm step that says exactly what will
// happen: now, or at the time the submitter proposed. Capacity is fetched for
// the "needs N, M left today" line; if it can't be read, the server's own
// OVER_MESSAGING_LIMIT check still stands behind the click.
function ApproveDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: ReviewTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (confirmOverLimit: boolean) => void;
}) {
  const [capacity, setCapacity] = useState<CampaignCapacity | null>(null);
  const [now] = useState(() => Date.now());
  // A proposed time already in the past sends straight away (server rule).
  const scheduled = !!target.scheduledAt && new Date(target.scheduledAt).getTime() > now;

  useEffect(() => {
    let cancelled = false;
    apiGetCampaignCapacity(target.id)
      .then((res) => !cancelled && setCapacity(res.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [target.id]);

  // Only a send-now is checked against today's limit; a schedule is checked
  // again when it starts.
  const over = !scheduled && !!capacity?.overLimit;

  return (
    <Modal onClose={onCancel} busy={busy}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-brand-fg" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-gray-900">Approve “{target.name}”?</h3>
          <p className="text-[13px] text-gray-500 mt-1">
            {scheduled
              ? `It will be scheduled for ${formatWhen(target.scheduledAt!)}, the time proposed by the submitter, and sent to ${target.totalRecipients.toLocaleString()} recipient${target.totalRecipients !== 1 ? "s" : ""}.`
              : `It starts sending to ${target.totalRecipients.toLocaleString()} recipient${target.totalRecipients !== 1 ? "s" : ""} right away.`}
          </p>
        </div>
      </div>

      {capacity && !capacity.unlimited && capacity.remaining != null && (
        <div
          className={`rounded-xl p-3 mb-4 text-[12px] ${
            over ? "bg-red-50 border border-red-200 text-red-700" : "bg-gray-50 border border-gray-200 text-gray-600"
          }`}
        >
          Needs <span className="font-semibold">{capacity.needed.toLocaleString()}</span> ·{" "}
          <span className="font-semibold">{capacity.remaining.toLocaleString()}</span> left today
          {capacity.limit != null && ` (limit ${capacity.limit.toLocaleString()} per 24 hours)`}
          {over && (
            <p className="mt-1">Messages past the limit will fail, and the campaign pauses until room frees up.</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(over)}
          disabled={busy}
          className={`flex items-center gap-1.5 text-[13px] font-semibold text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            over ? "bg-amber-500 hover:bg-amber-600" : "bg-brand hover:bg-[#2f5540]"
          }`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {over ? "Approve anyway" : scheduled ? "Approve & schedule" : "Approve & send"}
        </button>
      </div>
    </Modal>
  );
}

// ── Hook: the whole review flow for a page ───────────────────────────────────

/**
 * Approve / reject for any page that lists campaigns awaiting approval. Owns
 * the three dialogs and the over-limit retry so the pages only render
 * `dialogs` and call `startApprove` / `startReject`. `onChanged` runs after a
 * successful approve or reject (reload the list / campaign).
 */
export function useCampaignReview(onChanged: () => void) {
  const toast = useToast();
  const [approving, setApproving] = useState<ReviewTarget | null>(null);
  const [rejecting, setRejecting] = useState<ReviewTarget | null>(null);
  const [overLimit, setOverLimit] = useState<{ target: ReviewTarget; capacity: CampaignCapacity } | null>(null);
  const [busy, setBusy] = useState(false);

  const approve = async (target: ReviewTarget, confirmOverLimit: boolean) => {
    setBusy(true);
    try {
      const res = await apiApproveCampaign(target.id, { confirmOverLimit });
      setApproving(null);
      setOverLimit(null);
      toast.success(res.message ?? "Campaign approved.");
      onChanged();
    } catch (err) {
      const capacity = overLimitDetails(err);
      if (capacity) {
        // The capacity read in the dialog was stale or missing — show the
        // server's numbers and let the admin decide.
        setApproving(null);
        setOverLimit({ target, capacity });
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't approve campaign.");
      }
    } finally {
      setBusy(false);
    }
  };

  const reject = async (target: ReviewTarget, reason: string) => {
    setBusy(true);
    try {
      await apiRejectCampaign(target.id, reason);
      setRejecting(null);
      toast.success("Campaign rejected — sent back to drafts.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reject campaign.");
    } finally {
      setBusy(false);
    }
  };

  const dialogs = (
    <>
      {approving && (
        <ApproveDialog
          target={approving}
          busy={busy}
          onCancel={() => setApproving(null)}
          onConfirm={(confirm) => approve(approving, confirm)}
        />
      )}
      {overLimit && (
        <OverLimitDialog
          capacity={overLimit.capacity}
          actionLabel="Approve anyway"
          busy={busy}
          onCancel={() => setOverLimit(null)}
          onConfirm={() => approve(overLimit.target, true)}
        />
      )}
      {rejecting && (
        <RejectReasonDialog
          campaignName={rejecting.name}
          busy={busy}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => reject(rejecting, reason)}
        />
      )}
    </>
  );

  return {
    startApprove: (target: ReviewTarget) => setApproving(target),
    startReject: (target: ReviewTarget) => setRejecting(target),
    reviewing: busy,
    dialogs,
  };
}
