"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { decidedSince, getTemplatesSeenAt, markTemplatesSeen } from "@/lib/templateUpdates";
import {
  Plus,
  RefreshCw,
  Lock,
  Pencil,
  Trash2,
  Send,
  AlertCircle,
  DownloadCloud,
  Wand2,
} from "lucide-react";
import {
  apiGetTemplates,
  apiDeleteTemplate,
  apiSubmitTemplate,
  ApiError,
  apiSyncTemplates,
} from "@/lib/api";
import { HeaderPreview, ButtonRow, WaText } from "@/components/templates/shared";
import { CarouselPreview } from "@/components/templates/CarouselEditor";
import ImportFromMetaModal, { SETUP_NEED_LABEL } from "@/components/templates/ImportFromMetaModal";
import TemplateSetupModal from "@/components/templates/TemplateSetupModal";
import type {
  Template,
  TemplateCategory,
  TemplateStatus,
} from "@/types";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { PageSpinner } from "@/components/ui/spinner";

// ---------------------------------------------------------------------------
// Config / Badges
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  TemplateStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  DRAFT: {
    label: "Draft",
    bg: "bg-gray-100",
    text: "text-gray-600",
    border: "border-gray-200",
  },
  SUBMITTED: {
    label: "Submitted",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  REJECTED: {
    label: "Rejected",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  // Meta stopped an approved template (quality / blocks). Can't be sent.
  PAUSED: {
    label: "Paused by Meta",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  DISABLED: {
    label: "Disabled by Meta",
    bg: "bg-gray-100",
    text: "text-gray-500",
    border: "border-gray-200",
  },
};

const CATEGORY_CONFIG: Record<
  TemplateCategory,
  { label: string; bg: string; text: string }
> = {
  GENERAL: { label: "General", bg: "bg-brand-100", text: "text-brand-fg" },
  RE_ENGAGEMENT: {
    label: "Re-engagement",
    bg: "bg-orange-50",
    text: "text-orange-700",
  },
  CAMPAIGN: { label: "Campaign", bg: "bg-purple-50", text: "text-purple-700" },
};

function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: TemplateCategory }) {
  const cfg = CATEGORY_CONFIG[category];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SubmitConfirmModal
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  header: "Header", body: "Message body", footer: "Footer", buttons: "Buttons", name: "Name / language",
};

function SubmitConfirmModal({
  template,
  onConfirm,
  onCancel,
  onFix,
}: {
  template: Template;
  onConfirm: () => void;
  onCancel: () => void;
  onFix: (field: string | null, reason: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which part of the template the error is about, when the server knows.
  const [errorField, setErrorField] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    setErrorField(null);
    setRejected(false);
    try {
      await apiSubmitTemplate(template.id);
      onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach Meta. Please try again.");
      if (err instanceof ApiError) {
        setErrorField(err.details?.field ?? null);
        setRejected(err.code === "META_REJECTED" || err.code === "TEMPLATE_INVALID");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Send className="w-5 h-5 text-blue-600" />
        </div>
        <h2 className="text-[16px] font-bold text-gray-900 text-center mb-2">
          Submit for Approval?
        </h2>
        <p className="text-[13px] text-gray-500 text-center mb-1">
          <strong className="text-gray-700">{template.name}</strong> will be
          sent to Meta for review.
        </p>
        <p className="text-[13px] text-gray-400 text-center mb-5">
          Meta reviews typically take 24–48 hours. You won&apos;t be able to
          edit while it&apos;s under review.
        </p>
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 text-left">
            <p className="text-[12px] font-semibold text-red-700">
              {rejected ? "Meta can't accept this template" : "Couldn't submit"}
              {errorField && FIELD_LABELS[errorField] ? ` — ${FIELD_LABELS[errorField]}` : ""}
            </p>
            <p className="text-[12px] text-red-600 mt-0.5">{error}</p>
            {rejected && (
              <button
                type="button"
                onClick={() => onFix(errorField, error)}
                className="mt-2 text-[12px] font-semibold text-red-700 underline hover:no-underline cursor-pointer"
              >
                {errorField && FIELD_LABELS[errorField] ? `Fix ${FIELD_LABELS[errorField].toLowerCase()}` : "Edit template"} →
              </button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-[14px] font-semibold text-white cursor-pointer transition-colors"
          >
            {loading ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  template,
  onConfirm,
  onCancel,
}: {
  template: Template;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await apiDeleteTemplate(template.id);
      onConfirm();
    } catch {
      setError("Failed to delete. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-5 h-5 text-red-500" />
        </div>
        <h2 className="text-[16px] font-bold text-gray-900 text-center mb-2">
          Delete Template?
        </h2>
        <p className="text-[13px] text-gray-500 text-center mb-5">
          <strong className="text-gray-700">{template.name}</strong> will be
          removed permanently.
        </p>
        {error && (
          <p className="text-[13px] text-red-500 text-center mb-4">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-[14px] font-semibold text-white cursor-pointer transition-colors"
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onEdit,
  onSubmit,
  onDelete,
  onSetup,
}: {
  template: Template;
  onEdit: () => void;
  onSubmit: () => void;
  onDelete: () => void;
  onSetup: () => void;
}) {
  // An imported template the CRM can't send yet (see TemplateSetupModal).
  const needsSetup = template.needsSetup ?? [];
  const canEdit =
    template.approvalStatus === "DRAFT" ||
    template.approvalStatus === "REJECTED";
  const canSubmit =
    template.approvalStatus === "DRAFT" ||
    template.approvalStatus === "REJECTED";

  return (
    <div className="bg-white rounded-xl border border-gray-100 hover:border-gray-200 transition-colors flex flex-col overflow-hidden">
      {/* Card header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-gray-900 truncate">
              {template.name}
            </h3>
            {template.metaTemplateName && (
              <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                {template.metaTemplateName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
            <CategoryBadge category={template.category} />
            <TemplateStatusBadge status={template.approvalStatus} />
            {needsSetup.length > 0 && (
              <span
                title={`Can't be sent until you ${needsSetup.map((n) => SETUP_NEED_LABEL[n]).join(" and ")}`}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200"
              >
                Needs setup
              </span>
            )}
          </div>
        </div>

        {needsSetup.length > 0 && (
          <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-2">
            <AlertCircle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-snug">
              Imported from Meta — {needsSetup.map((n) => SETUP_NEED_LABEL[n]).join(" and ")} before it can be sent.
            </p>
          </div>
        )}

        {template.approvalStatus === "REJECTED" && template.rejectionReason && (
          <div className="flex items-start gap-1.5 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mt-2">
            <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700 leading-snug">
              <strong>Rejected:</strong> {template.rejectionReason}
            </p>
          </div>
        )}
      </div>

      {/* Scrollable bubble area */}
      <div className="mx-3 mb-3 flex-1 overflow-y-auto max-h-80 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[#2f5840]/30 [&::-webkit-scrollbar-thumb]:rounded-full">
        {/* Dark green WhatsApp bubble */}
        <div className="bg-brand rounded-2xl rounded-br-sm px-3.5 py-3 shadow-sm">
          <HeaderPreview headerType={template.headerType} header={template.header} headerMediaUrl={template.headerMediaUrl} />
          <p className="text-[13px] text-white leading-relaxed whitespace-pre-wrap">
            <WaText text={template.body} />
          </p>
          {template.footer && (
            <p className="text-[11px] text-white/55 italic mt-2 leading-snug">
              {template.footer}
            </p>
          )}
          <div className="flex justify-end mt-2">
            <span className="text-[10px] text-white/50">15:32 ✓✓</span>
          </div>
        </div>

        {/* Carousel cards */}
        {template.cards && template.cards.length > 0 && <CarouselPreview cards={template.cards} />}

        {/* CTA buttons */}
        {template.buttons && template.buttons.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {template.buttons.map((btn) => (
              <ButtonRow key={btn.id} btn={btn} />
            ))}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="shrink-0 flex items-stretch border-t border-gray-100 divide-x divide-gray-100 text-[12px] font-medium">
        <span className="flex items-center px-3 py-2.5 text-[10px] text-gray-400 flex-1 truncate">
          {template.language}
        </span>
        {needsSetup.length > 0 && (
          <button
            type="button"
            onClick={onSetup}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-amber-700 hover:bg-amber-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Wand2 className="w-3.5 h-3.5" /> Set up
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        {canSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            {template.approvalStatus === "REJECTED" ? "Resubmit" : "Submit"}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center justify-center px-3 py-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const STATUS_FILTERS: (TemplateStatus | "ALL")[] = [
  "ALL",
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
];

export default function TemplatesPage() {
  const router = useRouter();
  // Access comes from the server's permission list, never from the role
  // name: see CurrentUserProvider. `ready` is false until /users/me answers.
  const { ready, can } = useCurrentUser();
  const allowed = can("template:write");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "ALL">(
    "ALL",
  );

  // Meta decisions since the previous visit, captured once before this visit
  // marks everything as seen.
  const [seenBefore] = useState(() => (typeof window === "undefined" ? "" : getTemplatesSeenAt()));
  const [hideNews, setHideNews] = useState(false);
  const news = seenBefore ? decidedSince(templates, seenBefore) : [];

  useEffect(() => {
    if (allowed) markTemplatesSeen();
  }, [allowed]);

  const [submitModal, setSubmitModal] = useState<Template | null>(null);
  const [deleteModal, setDeleteModal] = useState<Template | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [setupModal, setSetupModal] = useState<Template | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params =
        statusFilter !== "ALL" ? { status: statusFilter } : undefined;
      const res = await apiGetTemplates(params);
      setTemplates(res.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Cards update live when Meta decides while this page is open.
  useEffect(() => {
    if (!allowed) return;
    const socket = getSocket();
    socket.on("template.status_changed", fetchTemplates);
    return () => { socket.off("template.status_changed", fetchTemplates); };
  }, [allowed, fetchTemplates]);

  useEffect(() => {
    if (allowed) fetchTemplates();
    else if (ready) setLoading(false);
  }, [allowed, ready, fetchTemplates]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiSyncTemplates();
      setSyncResult(
        `Synced — ${res.approved} approved, ${res.rejected} rejected`,
      );
      await fetchTemplates();
    } catch {
      setSyncResult("Sync failed. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  if (!ready) return <PageSpinner />;

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full gap-3">
        <Lock className="w-10 h-10 text-gray-300" />
        <h1 className="text-lg font-semibold text-gray-500">
          Admin access only
        </h1>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 bg-gray-50 min-h-full overflow-y-auto">
      {/* Modals */}
      {submitModal && (
        <SubmitConfirmModal
          template={submitModal}
          onConfirm={() => {
            setSubmitModal(null);
            fetchTemplates();
          }}
          onCancel={() => setSubmitModal(null)}
          onFix={(field, reason) => {
            const id = submitModal.id;
            setSubmitModal(null);
            const qs = new URLSearchParams({ reason, ...(field ? { fix: field } : {}) });
            router.push(`/templates/${id}/edit?${qs}`);
          }}
        />
      )}
      {deleteModal && (
        <DeleteConfirmModal
          template={deleteModal}
          onConfirm={() => {
            setDeleteModal(null);
            fetchTemplates();
          }}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      {importOpen && (
        <ImportFromMetaModal onClose={() => setImportOpen(false)} onImported={fetchTemplates} />
      )}
      {setupModal && (
        <TemplateSetupModal
          template={setupModal}
          onClose={() => setSetupModal(null)}
          onSaved={() => {
            setSetupModal(null);
            fetchTemplates();
          }}
        />
      )}

      {news.length > 0 && !hideNews && (
        <div className="flex items-start justify-between gap-3 bg-brand-100 border border-brand/20 rounded-xl px-4 py-3 mb-5">
          <div className="text-[13px] text-gray-700 space-y-0.5">
            <p className="font-semibold text-brand-fg">Since your last visit</p>
            {news.map((t) => (
              <p key={t.id}>
                {t.approvalStatus === "APPROVED" ? "✅" : "❌"} <span className="font-medium">{t.name}</span>{" "}
                {t.approvalStatus === "APPROVED" ? "was approved — ready to use in campaigns." : `was rejected${t.rejectionReason ? `: ${t.rejectionReason}` : "."}`}
              </p>
            ))}
          </div>
          <button type="button" onClick={() => setHideNews(true)} className="text-[12px] text-gray-500 hover:text-gray-700 cursor-pointer shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Templates</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage WhatsApp message templates for agents
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {syncResult && (
            <span className="text-[12px] text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
              {syncResult}
            </span>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 border border-gray-200 bg-white rounded-xl px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60 cursor-pointer transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing…" : "Sync Status"}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 border border-gray-200 bg-white rounded-xl px-4 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            Import from Meta
          </button>
          <button
            type="button"
            onClick={() => router.push("/templates/new")}
            className="flex items-center gap-2 bg-brand hover:bg-[#2f5840] text-white rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Template
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-[13px] border transition-colors cursor-pointer font-medium ${
              statusFilter === f
                ? "bg-brand-200 border-brand text-brand-fg"
                : "border-gray-200 text-gray-500 hover:bg-gray-50 bg-white"
            }`}
          >
            {f === "ALL" ? "All" : STATUS_CONFIG[f].label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse space-y-3"
            >
              <div className="flex justify-between">
                <div className="h-4 bg-gray-100 rounded w-1/2" />
                <div className="h-5 bg-gray-100 rounded-full w-20" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <Send className="w-7 h-7 text-gray-300" />
          </div>
          <h2 className="text-[16px] font-semibold text-gray-500 mb-1">
            No templates
          </h2>
          <p className="text-[13px] text-gray-400 mb-5">
            {statusFilter !== "ALL"
              ? "No templates with this status."
              : "Create your first template to get started."}
          </p>
          {statusFilter === "ALL" && (
            <button
              type="button"
              onClick={() => router.push("/templates/new")}
              className="flex items-center gap-2 bg-brand hover:bg-[#2f5840] text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" /> New Template
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => router.push(`/templates/${tpl.id}/edit`)}
              onSubmit={() => setSubmitModal(tpl)}
              onDelete={() => setDeleteModal(tpl)}
              onSetup={() => setSetupModal(tpl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
