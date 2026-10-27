"use client";

import { Suspense, useEffect, useState, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ArrowLeft, Loader2, Search, ChevronRight, ChevronLeft, Lock, Send, AlertCircle, ShieldCheck, Clock } from "lucide-react";
import type { Template, Customer, Conversation, ContactList, Segment, CampaignCategory, CampaignCapacity } from "@/types";
import {
  ApiError,
  apiCampaignNameAvailable,
  apiGetTemplates,
  apiGetCampaign,
  apiGetCustomers,
  apiGetConversations,
  apiCreateCampaign,
  apiUpdateCampaign,
  apiSendCampaignNow,
  apiSubmitCampaign,
  apiGetLists,
  apiGetListMemberIds,
  apiGetSegments,
  apiGetSegment,
  apiGetSegmentMemberIds,
  apiTestSendTemplate,
  apiGetTestPhones,
  apiGetWhatsAppStatus,
  apiGetQuietHours,
} from "@/lib/api";
import { isQuietAt, nextOpenAfter, formatClock, type QuietHours } from "@/lib/quietHours";
import { assessTier, type TierVerdict } from "@/lib/whatsappTiers";
import { useToast } from "@/components/ui/toast";
import { useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { describeRule } from "@/components/SegmentBuilder";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { CAMPAIGN_CATEGORIES, CAMPAIGN_CATEGORY_COLORS } from "@/lib/campaignCategories";
import { FlowPicker } from "@/components/flows/FlowPicker";
import { LIMITS } from "@/components/templates/shared";
import { WaPhone, WaTemplateMessage } from "@/components/whatsapp/WaPreview";
import { OverLimitDialog, overLimitDetails } from "@/components/CampaignApprovalDialogs";

// ── Constants ────────────────────────────────────────────────────────────────

// WhatsApp Cloud API per-message rates (USD) for UAE (+971), by Meta billing
// category — Meta rate card effective July 1, 2025 (per-message pricing).
// Meta revises these periodically: verify against WhatsApp Manager → Billing
// (or Meta's rate-card CSV) and update the values here when they change.
const UAE_RATES_USD = {
  MARKETING: 0.0384,
  UTILITY: 0.0157,
  AUTHENTICATION: 0.0178,
} as const;

// Map this CRM's template categories onto Meta's billing categories.
const META_BILLING_CATEGORY: Record<string, keyof typeof UAE_RATES_USD> = {
  CAMPAIGN: "MARKETING",
  RE_ENGAGEMENT: "MARKETING",
  GENERAL: "UTILITY",
};

// Per-message cost for a template; unknown categories assume the priciest
// (MARKETING) so the estimate errs high, never low.
function costPerMsg(template?: Template | null): number {
  return UAE_RATES_USD[META_BILLING_CATEGORY[template?.category ?? ""] ?? "MARKETING"];
}

// The backend sends up to CAMPAIGN_SEND_CONCURRENCY (5) recipients in
// parallel rather than one at a time, so the effective per-recipient wall
// time is roughly a single send's DB-round-trips + WhatsApp API latency,
// divided across the batch. We don't have hard production timing data for
// that, so we estimate a range instead of a single number that would look
// more precise than it is.
const SEND_SEC_PER_MSG_MIN = 0.15; // optimistic: fast DB + fast Meta response
const SEND_SEC_PER_MSG_MAX = 0.5; // pessimistic: slower DB/API latency


const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "General",
  CAMPAIGN: "Promotion",
  RE_ENGAGEMENT: "Re-engage",
};

const CATEGORY_COLORS: Record<string, string> = {
  GENERAL: "bg-blue-50 text-blue-600",
  CAMPAIGN: "bg-purple-50 text-purple-600",
  RE_ENGAGEMENT: "bg-orange-50 text-orange-600",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function extractVars(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) || [];
  return [...new Set(matches)];
}

function resolvePreview(text: string | null | undefined, sampleName: string): string {
  if (!text) return "";
  const first = sampleName.split(" ")[0] || "Customer";
  return text
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{customer_name\}\}/g, sampleName || "Customer")
    .replace(/\{\{agent_name\}\}/g, "Team");
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepDot({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "done" | "active" | "pending";
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
          state === "done"
            ? "bg-brand text-white"
            : state === "active"
            ? "bg-brand text-white ring-4 ring-brand-200"
            : "bg-gray-100 text-gray-400"
        }`}
      >
        {state === "done" ? <Check className="w-3 h-3" /> : n}
      </div>
      <span
        className={`text-[13px] font-medium ${
          state === "active" ? "text-gray-900" : state === "done" ? "text-brand-fg" : "text-gray-400"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ── WhatsApp Preview Bubble ───────────────────────────────────────────────────

// The same WhatsApp pieces as the template editor's preview, on the
// customer's phone, so what you pick here looks like what they receive.
function WaBubble({ template, sampleName }: { template: Template; sampleName: string }) {
  return (
    <WaPhone className="w-full max-w-[360px]">
      <WaTemplateMessage
        headerType={template.headerType ?? "NONE"}
        header={resolvePreview(template.header, sampleName)}
        headerMediaUrl={template.headerMediaUrl}
        body={resolvePreview(template.body, sampleName)}
        footer={template.footer}
        buttons={template.buttons ?? []}
        cards={template.cards}
      />
    </WaPhone>
  );
}

// ── Step 1: Choose Template ───────────────────────────────────────────────────

function Step1({
  selected,
  onSelect,
  sampleName,
}: {
  selected: Template | null;
  onSelect: (t: Template) => void;
  sampleName: string;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetTemplates({ status: "APPROVED", category: "CAMPAIGN" })
      // An imported template whose variables/media aren't set up can't be
      // sent (the API refuses it: TEMPLATE_NEEDS_SETUP / TEMPLATE_NEEDS_MEDIA).
      .then((res) => setTemplates(res.data.filter((t) => !t.needsSetup?.length)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Template list */}
      <div className="w-[55%] border-r border-gray-100 overflow-y-auto p-6 space-y-3">
        <h2 className="text-[18px] font-bold text-gray-900">Choose a template</h2>
        <p className="text-[13px] text-gray-500 mb-4">Pick a saved message template. Variables fill in per recipient.</p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-gray-400">No approved Campaign templates found.</div>
        ) : (
          templates.map((t) => {
            const vars = extractVars(t.body);
            const isSelected = selected?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className={`w-full text-left rounded-xl border p-4 transition-all cursor-pointer ${
                  isSelected
                    ? "border-brand bg-brand-100 ring-1 ring-brand"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? "border-brand bg-brand" : "border-gray-300"
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-[14px] font-semibold text-gray-800">{t.name}</span>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[t.category] ?? "bg-gray-100 text-gray-500"}`}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                </div>
                <p className="text-[12px] text-gray-500 line-clamp-2 mb-2 ml-6">{t.body}</p>
                {vars.length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-6">
                    {vars.map((v) => (
                      <span key={v} className="text-[11px] font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md">{v}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })
        )}

        <a
          href="/templates"
          className="block text-center text-[13px] text-brand-fg hover:underline py-3 border border-dashed border-gray-200 rounded-xl cursor-pointer"
        >
          + New template
        </a>
      </div>

      {/* Live preview */}
      <div className="w-[45%] bg-canvas-warm flex flex-col items-center justify-start p-8 overflow-y-auto">
        <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-4 self-start">Live Preview</p>
        {selected ? (
          <>
            <div className="self-start w-full flex justify-center">
              <WaBubble template={selected} sampleName={sampleName} />
            </div>
            <p className="self-start text-[11px] text-gray-400 mt-3">
              Renders for: {sampleName || "Sample Customer"}
            </p>
            <p className="self-start text-[11px] text-gray-400 mt-0.5">
              {selected.body.length}/{LIMITS.body}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/60 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-[13px] text-gray-400">Select a template to see a preview</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Messaging-limit pre-flight ────────────────────────────────────────────────

// Meta caps how many unique people a number may start conversations with in a
// rolling 24 hours. Exceeding it doesn't fail up front — the campaign starts
// and then dies partway through, recipient by recipient. So warn here, before
// anyone commits.
function TierWarning({ verdict }: { verdict: TierVerdict }) {
  if (verdict.level === "ok" || verdict.level === "unlimited") return null;

  if (verdict.level === "unknown") {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
        <p className="text-[12px] font-semibold text-gray-600">Messaging limit unknown</p>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
          Meta hasn&apos;t reported a tier for this number yet. Start with a small send and check Number Health afterwards.
        </p>
      </div>
    );
  }

  const over = verdict.level === "over";
  return (
    <div
      className={
        over
          ? "bg-red-50 border border-red-200 rounded-xl p-3"
          : "bg-amber-50 border border-amber-200 rounded-xl p-3"
      }
    >
      <p className={`text-[12px] font-semibold ${over ? "text-red-700" : "text-amber-700"}`}>
        {over
          ? "\u26a0 Over your 24-hour messaging limit"
          : "\u26a0 Close to your 24-hour messaging limit"}
      </p>
      <p className={`text-[11px] mt-0.5 leading-relaxed ${over ? "text-red-600" : "text-amber-600"}`}>
        {verdict.used.toLocaleString()} recipients against a cap of {verdict.cap.toLocaleString()} unique
        contacts per rolling 24 hours.
        {over
          ? " Sends past the cap will fail individually once it's reached — split this into smaller batches across days."
          : " Anything else you've sent in the last 24 hours counts toward the same cap."}
      </p>
    </div>
  );
}

// ── Step 2: Select Recipients ─────────────────────────────────────────────────

function Step2({
  selectedIds,
  onToggle,
  onToggleAll,
  customers,
  convMap,
  loading,
  template,
  tier,
  segmentAudience,
  onPickSegment,
  selectedListIds,
  setSelectedListIds,
  listMembersCache,
  setListMembersCache,
}: {
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (ids: number[], select: boolean) => void;
  customers: Customer[];
  convMap: Map<number, Conversation>;
  loading: boolean;
  template: Template | null;
  tier: string | null | undefined;
  segmentAudience: Segment | null;
  onPickSegment: (segment: Segment | null) => void;
  selectedListIds: Set<number>;
  setSelectedListIds: Dispatch<SetStateAction<Set<number>>>;
  listMembersCache: Record<number, number[]>;
  setListMembersCache: Dispatch<SetStateAction<Record<number, number[]>>>;
}) {
  const [mode, setMode] = useState<"contacts" | "lists" | "segments">(
    segmentAudience ? "segments" : "contacts"
  );
  // "Lapsed" is measured from their chats, which need inbox access.
  const showLapsed = useCurrentUser().can("conversation:read");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(true);
  const [pickingSegmentId, setPickingSegmentId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("All");
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingListId, setLoadingListId] = useState<number | null>(null);

  useEffect(() => {
    apiGetLists().then((res) => setLists(res.data)).catch(() => {}).finally(() => setLoadingLists(false));
  }, []);

  useEffect(() => {
    apiGetSegments().then((res) => setSegments(res.data)).catch(() => {}).finally(() => setLoadingSegments(false));
  }, []);

  // Picking a segment is exclusive: the payload carries either a segmentId or
  // a hand-picked list, never both, so choosing one clears whatever was
  // selected before. The resolved ids are handed to the parent as well, which
  // keeps the counter, tier check and cost estimate honest while the wizard is
  // open — the send itself is still resolved server-side from the rule.
  async function toggleSegment(segment: Segment) {
    if (pickingSegmentId !== null) return;
    if (segmentAudience?.id === segment.id) {
      onToggleAll([...selectedIds], false);
      onPickSegment(null);
      return;
    }
    setPickingSegmentId(segment.id);
    try {
      const res = await apiGetSegmentMemberIds(segment.id);
      onToggleAll([...selectedIds], false);
      onToggleAll(res.data.customerIds, true);
      onPickSegment(segment);
      setSelectedListIds(new Set());
    } catch {
      // leave the previous audience untouched
    } finally {
      setPickingSegmentId(null);
    }
  }

  async function toggleList(list: ContactList) {
    if (list.memberCount === 0 || loadingListId !== null) return;
    let ids = listMembersCache[list.id];
    if (!ids) {
      setLoadingListId(list.id);
      try {
        const res = await apiGetListMemberIds(list.id);
        ids = res.data.customerIds;
        setListMembersCache((prev) => ({ ...prev, [list.id]: ids! }));
      } catch {
        setLoadingListId(null);
        return;
      }
      setLoadingListId(null);
    }

    if (selectedListIds.has(list.id)) {
      // Turning off: only drop ids not also covered by another still-active list.
      const stillCovered = new Set<number>();
      selectedListIds.forEach((otherId) => {
        if (otherId === list.id) return;
        (listMembersCache[otherId] ?? []).forEach((id) => stillCovered.add(id));
      });
      onToggleAll(ids.filter((id) => !stillCovered.has(id)), false);
      setSelectedListIds((prev) => {
        const next = new Set(prev);
        next.delete(list.id);
        return next;
      });
    } else {
      onToggleAll(ids, true);
      setSelectedListIds((prev) => new Set(prev).add(list.id));
    }
  }

  const allTags = [...new Set(customers.flatMap((c) => c.tags))].sort();

  const now = Date.now();
  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    if (q && !c.name?.toLowerCase().includes(q) && !c.phone.includes(q)) return false;
    if (tagFilter === "All") return true;
    if (tagFilter === "Lapsed 60d+") {
      const conv = convMap.get(c.id ?? 0);
      if (!conv) return true;
      if (!conv.lastCustomerMessageAt) return true;
      return now - new Date(conv.lastCustomerMessageAt).getTime() > SIXTY_DAYS;
    }
    return c.tags.includes(tagFilter);
  });

  const filteredIds = filtered.map((c) => c.id as number).filter(Boolean);
  const optedOut = customers.filter((c) => (c as Customer & { optedOut?: boolean }).optedOut).length;
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const rate = costPerMsg(template);
  const estimatedSecondsMin = selectedIds.size * SEND_SEC_PER_MSG_MIN;
  const estimatedSecondsMax = selectedIds.size * SEND_SEC_PER_MSG_MAX;
  const estimatedCost = (selectedIds.size * rate).toFixed(2);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main */}
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-[18px] font-bold text-gray-900 mb-1">Select recipients</h2>
        <p className="text-[13px] text-gray-500 mb-4">
          {selectedIds.size} recipient{selectedIds.size !== 1 ? "s" : ""} selected.
        </p>

        {/* Contacts / Lists toggle */}
        <div className="inline-flex items-center bg-gray-100 rounded-xl p-1 mb-5">
          <button
            type="button"
            onClick={() => setMode("contacts")}
            className={`text-[13px] font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer ${
              mode === "contacts" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Contacts
          </button>
          <button
            type="button"
            onClick={() => setMode("lists")}
            className={`text-[13px] font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer ${
              mode === "lists" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Lists
          </button>
          <button
            type="button"
            onClick={() => setMode("segments")}
            className={`text-[13px] font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer ${
              mode === "segments" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Segments
          </button>
        </div>

        {mode === "segments" ? (
          loadingSegments ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
            </div>
          ) : segments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[13px] text-gray-400">No segments yet.</p>
              <p className="text-[12px] text-gray-400 mt-1">
                Create one from Contacts &rarr; Segments to target by rule instead of by hand.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-xl bg-brand-100 border border-brand/15 px-4 py-3 mb-4">
                <ShieldCheck className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" />
                <p className="text-[12px] text-brand-fg leading-relaxed">
                  A segment is re-run on the server when the campaign is created, and its
                  recipients are frozen at that moment. The number you approve is the number
                  that gets messaged.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {segments.map((sg) => {
                  const isOn = segmentAudience?.id === sg.id;
                  const isLoadingThis = pickingSegmentId === sg.id;
                  const broken = !!sg.error;
                  const empty = !sg.reachable;
                  return (
                    <button
                      key={sg.id}
                      type="button"
                      onClick={() => toggleSegment(sg)}
                      disabled={broken || empty || (pickingSegmentId !== null && !isLoadingThis)}
                      title={broken ? "This segment&apos;s rules no longer compile" : empty ? "Nobody matches this segment right now" : undefined}
                      className={`text-left rounded-xl border p-4 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        isOn ? "border-brand bg-brand-100 ring-1 ring-brand" : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isOn ? "border-brand bg-brand" : "border-gray-300"}`}>
                            {isOn && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                          </div>
                          <span className="text-[14px] font-semibold text-gray-800 truncate">{sg.name}</span>
                        </div>
                        {isLoadingThis && <Loader2 className="w-3.5 h-3.5 text-gray-300 animate-spin shrink-0" />}
                      </div>
                      <p className="text-[12px] text-gray-500 line-clamp-2 ml-6 mb-2">
                        {sg.description || (sg.definition?.rules ?? []).map((r) => describeRule(r, null)).join(sg.definition?.match === "ANY" ? " or " : " and ")}
                      </p>
                      <p className="text-[11px] text-gray-400 ml-6 tabular-nums">
                        {broken ? "Rules need fixing" : `${(sg.reachable ?? 0).toLocaleString()} contact${sg.reachable === 1 ? "" : "s"} right now`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </>
          )
        ) : mode === "contacts" ? (
          <>
            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="w-full pl-9 pr-4 py-2.5 text-[13px] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>

            {/* Tag filters */}
            <div className="flex flex-wrap gap-2 mb-4">
              {["All", ...allTags, ...(showLapsed ? ["Lapsed 60d+"] : [])].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className={`text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
                    tagFilter === tag
                      ? "bg-brand text-white border-brand"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => onToggleAll(filteredIds, e.target.checked)}
                          className="rounded border-gray-300 accent-brand"
                        />
                      </th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Name</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Phone</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Tag</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((c) => {
                      const isOptedOut = (c as Customer & { optedOut?: boolean }).optedOut;
                      const id = c.id as number;
                      const conv = convMap.get(id);
                      return (
                        <tr
                          key={id}
                          onClick={() => !isOptedOut && onToggle(id)}
                          className={`transition-colors ${isOptedOut ? "opacity-40 cursor-default" : "cursor-pointer hover:bg-gray-50"}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(id)}
                              disabled={isOptedOut}
                              onChange={() => onToggle(id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-gray-300 accent-brand"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-brand-fg">{initials(c.name)}</span>
                              </div>
                              <div>
                                <p className="font-medium text-gray-800 leading-tight">{c.name || "—"}</p>
                                {isOptedOut && <p className="text-[10px] text-red-400">opted out</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-500 font-mono text-[12px]">{c.phone}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {c.tags.slice(0, 2).map((tag) => (
                                <span key={tag} className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md">{tag}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-400 text-[12px]">
                            {conv?.lastMessage ? (
                              <span>{conv.lastMessage.slice(0, 35)}{conv.lastMessage.length > 35 ? "…" : ""} · {relativeDate(conv.lastMessageAt)}</span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : loadingLists ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
          </div>
        ) : lists.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-gray-400">
            No lists yet. Create one from Contacts → Lists.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {lists.map((l) => {
              const ids = listMembersCache[l.id];
              const selectedCount = ids ? ids.filter((id) => selectedIds.has(id)).length : 0;
              const isOn = selectedListIds.has(l.id);
              const isLoadingThis = loadingListId === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleList(l)}
                  disabled={l.memberCount === 0 || (loadingListId !== null && !isLoadingThis)}
                  className={`text-left rounded-xl border p-4 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isOn ? "border-brand bg-brand-100 ring-1 ring-brand" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isOn ? "border-brand bg-brand" : "border-gray-300"}`}>
                        {isOn && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                      </div>
                      <span className="text-[14px] font-semibold text-gray-800 truncate">{l.name}</span>
                    </div>
                    {isLoadingThis && <Loader2 className="w-3.5 h-3.5 text-gray-300 animate-spin shrink-0" />}
                  </div>
                  <p className="text-[12px] text-gray-500 line-clamp-2 ml-6 mb-2">{l.description || "No description"}</p>
                  <p className="text-[11px] text-gray-400 ml-6">
                    {ids ? `${selectedCount} of ${ids.length} selected` : `${l.memberCount.toLocaleString()} contact${l.memberCount !== 1 ? "s" : ""}`}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-[280px] border-l border-gray-100 bg-white p-5 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <div>
          <p className="text-[40px] font-bold text-gray-900 leading-none">{selectedIds.size}</p>
          <p className="text-[13px] text-gray-400 mt-1">recipients selected</p>
        </div>
        <div className="space-y-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-gray-500">Estimated send time</span>
            <span className="font-medium text-gray-800">≈ {formatDuration(estimatedSecondsMin)}–{formatDuration(estimatedSecondsMax)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Send rate</span>
            <span className="font-medium text-gray-800">~{SEND_SEC_PER_MSG_MIN.toFixed(1)}–{SEND_SEC_PER_MSG_MAX.toFixed(1)}s/msg</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Per-message cost</span>
            <span className="font-medium text-gray-800">${rate.toFixed(4)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-3">
            <span className="text-gray-500">Estimated total</span>
            <span className="font-semibold text-gray-900">${estimatedCost}</span>
          </div>
        </div>
        {selectedIds.size > 0 && <TierWarning verdict={assessTier(tier, selectedIds.size)} />}
        {optedOut > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-[12px] font-semibold text-amber-700">⚠ {optedOut} contact{optedOut > 1 ? "s" : ""} have opted out</p>
            <p className="text-[11px] text-amber-600 mt-0.5">They'll be skipped automatically.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Test Send ─────────────────────────────────────────────────────────────────

// A pre-flight check: fire this exact template at one number and look at it on
// a real handset. Sends nothing to the campaign's recipients and records no
// campaign data.
// Only to the staff test numbers an admin set in Settings → Campaign safety.
function TestSendBox({ template }: { template: Template }) {
  const [phones, setPhones] = useState<string[] | null>(null);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiGetTestPhones()
      .then((res) => {
        if (cancelled) return;
        setPhones(res.data);
        setPhone((p) => p || res.data[0] || "");
      })
      .catch(() => { if (!cancelled) setPhones([]); });
    return () => { cancelled = true; };
  }, []);
  const [result, setResult] = useState<
    { ok: true; to: string; personalizedFor: string | null; asMetaTemplate: boolean } | { ok: false; message: string } | null
  >(null);

  async function handleTest() {
    if (!phone.trim() || sending) return;
    setSending(true);
    setResult(null);
    try {
      // Stored as digits; the "+" makes the country code unambiguous.
      const res = await apiTestSendTemplate(template.id, `+${phone.trim()}`);
      setResult({
        ok: true,
        to: res.data.to,
        personalizedFor: res.data.personalizedFor,
        asMetaTemplate: res.data.asMetaTemplate,
      });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Test send failed." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-gray-100 pt-4">
      <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-2">Test first</p>
      <p className="text-[12px] text-gray-500 mb-2.5 leading-relaxed">
        Send this template to a staff test number and check it on a handset. Nothing is recorded against the campaign.
      </p>
      {phones !== null && phones.length === 0 ? (
        <p className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 leading-relaxed">
          No test numbers yet. An admin can add test numbers in Settings → Campaign safety.
        </p>
      ) : (
      <div className="flex gap-1.5">
        <div className="relative flex-1 min-w-0">
          <select
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={phones === null}
            aria-label="Test number"
            className="w-full px-3 py-2 pr-7 text-[13px] border border-gray-200 rounded-xl bg-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-60"
          >
            {phones === null && <option value="">Loading…</option>}
            {(phones ?? []).map((p) => <option key={p} value={p}>+{p}</option>)}
          </select>
          <svg className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={sending || !phone.trim()}
          className="flex items-center gap-1.5 text-[13px] font-medium text-brand-fg border border-brand/30 hover:bg-brand-100 px-3 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Test
        </button>
      </div>
      )}

      {result?.ok === true && (
        <div className="mt-2.5 bg-brand-100 border border-brand/20 rounded-xl p-2.5">
          <p className="text-[12px] font-semibold text-brand-fg">Test sent to +{result.to}</p>
          <p className="text-[11px] text-brand-fg/80 mt-0.5">
            {result.personalizedFor
              ? "Personalized for " + result.personalizedFor + " — exactly as a recipient will see it."
              : "That number isn't a saved contact, so variables used sample values."}
          </p>
          {!result.asMetaTemplate && (
            <p className="text-[11px] text-amber-700 mt-1">
              Sent as a plain message, not an approved template — a real campaign to a cold number will look the same but may be rejected.
            </p>
          )}
        </div>
      )}

      {result?.ok === false && (
        <div className="mt-2.5 bg-red-50 border border-red-100 rounded-xl p-2.5 flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-600 leading-relaxed">{result.message}</p>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Review & Schedule ─────────────────────────────────────────────────

function Step3({
  template,
  segmentAudience,
  selectedIds,
  customers,
  campaignName,
  onNameChange,
  nameTaken,
  nameInputRef,
  category,
  onCategoryChange,
  flowId,
  onFlowChange,
  onGoStep,
  onSubmit,
  submitting,
  tier,
  canSend,
  initialScheduledAt,
  rejectionReason,
}: {
  template: Template;
  segmentAudience: Segment | null;
  selectedIds: Set<number>;
  customers: Customer[];
  campaignName: string;
  onNameChange: (v: string) => void;
  // The server's CAMPAIGN_NAME_TAKEN answer, shown right under the name field.
  nameTaken: string | null;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  category: CampaignCategory | null;
  onCategoryChange: (v: CampaignCategory) => void;
  flowId: number | null;
  onFlowChange: (id: number | null) => void;
  onGoStep: (n: number) => void;
  onSubmit: (scheduledAt?: string) => void;
  submitting: boolean;
  tier: string | null | undefined;
  // Without campaign:send the final step submits for approval instead of
  // sending, and the schedule becomes a proposed send time.
  canSend: boolean;
  // A draft's saved (proposed) time, so reopening it doesn't lose it.
  initialScheduledAt: string | null;
  // Set when an admin sent this draft back.
  rejectionReason: string | null;
}) {
  // Pre-filled from the draft in the device's timezone, the same one the
  // picker below defaults to. Only a future time is worth keeping.
  const [initialSched] = useState(() => {
    if (!initialScheduledAt || new Date(initialScheduledAt).getTime() <= Date.now()) return null;
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(initialScheduledAt)).map(({ type, value }) => [type, value]),
    );
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  });
  const [sendMode, setSendMode] = useState<"now" | "later">(initialSched ? "later" : "now");
  const [schedDate, setSchedDate] = useState(initialSched?.date ?? "");
  const [schedTime, setSchedTime] = useState(initialSched?.time ?? "");
  const [schedTz, setSchedTz] = useState("Asia/Dubai");
  const [quietHours, setQuietHours] = useState<QuietHours | null>(null);

  useEffect(() => {
    apiGetQuietHours().then((res) => setQuietHours(res.data)).catch(() => {});
  }, []);
  const [detectedTz, setDetectedTz] = useState<string | null>(null);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) { setDetectedTz(tz); setSchedTz(tz); }
  }, []);


  const count = selectedIds.size;
  const rate = costPerMsg(template);
  const estimatedSecondsMin = count * SEND_SEC_PER_MSG_MIN;
  const estimatedSecondsMax = count * SEND_SEC_PER_MSG_MAX;
  const estimatedCost = (count * rate).toFixed(2);

  const selectedCustomers = customers.filter((c) => selectedIds.has(c.id as number));
  const tagCounts: Record<string, number> = {};
  selectedCustomers.forEach((c) => c.tags.forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tagSummary = Object.entries(tagCounts).map(([t, n]) => `${n} ${t}`).join(" · ");

  const sampleName = selectedCustomers[0]?.name || "Sample Customer";

  function tzToISO(date: string, time: string, tz: string): string {
    const naiveUtc = new Date(`${date}T${time}:00.000Z`);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(naiveUtc).map(({ type, value }) => [type, value]));
    const h = p.hour === "24" ? "00" : p.hour;
    const tzAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}.000Z`).getTime();
    return new Date(naiveUtc.getTime() - (tzAsUtc - naiveUtc.getTime())).toISOString();
  }

  const scheduledAt = sendMode === "later" && schedDate && schedTime
    ? tzToISO(schedDate, schedTime, schedTz)
    : undefined;

  // The server refuses a schedule inside quiet hours; this says so up front.
  const scheduleInQuiet = !!scheduledAt && isQuietAt(new Date(scheduledAt), quietHours);
  // Only meaningful for a send that starts now; an approval can come any time.
  const nowInQuiet = canSend && sendMode === "now" && isQuietAt(new Date(), quietHours);
  const applyFirstAllowedTime = () => {
    if (!scheduledAt) return;
    const open = nextOpenAfter(new Date(scheduledAt), quietHours);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: schedTz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(open).map(({ type, value }) => [type, value]),
    );
    setSchedDate(`${parts.year}-${parts.month}-${parts.day}`);
    setSchedTime(`${parts.hour}:${parts.minute}`);
  };

  const startDisplay = sendMode === "now"
    ? canSend ? "Now" : "When approved"
    : scheduledAt
    ? new Date(scheduledAt).toLocaleString("en-US", { timeZone: schedTz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

  const etaMs = sendMode === "now" ? Date.now() : scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
  const etaFinishMin = new Date(etaMs + estimatedSecondsMin * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const etaFinishMax = new Date(etaMs + estimatedSecondsMax * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <h2 className="text-[18px] font-bold text-gray-900">{canSend ? "Review & schedule" : "Review & submit"}</h2>
        <p className="text-[13px] text-gray-500">
          {canSend
            ? "Double-check everything before sending."
            : "Double-check everything, then submit it for an admin to approve. Approving is what sends it."}
        </p>

        {/* Why the last submission came back */}
        {rejectionReason && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-[12px] text-red-700 min-w-0">
              <p className="font-semibold">An admin sent this back</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{rejectionReason}</p>
              {!canSend && <p className="mt-1 text-red-500">Fix it, then submit again.</p>}
            </div>
          </div>
        )}

        {/* Campaign name */}
        <div>
          <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Campaign name</label>
          <input
            ref={nameInputRef}
            value={campaignName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="My campaign"
            aria-invalid={Boolean(nameTaken)}
            className={`w-full px-4 py-2.5 text-[14px] border rounded-xl focus:outline-none focus:ring-2 ${nameTaken ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-gray-200 focus:ring-brand/20 focus:border-brand"}`}
          />
          {nameTaken && <p className="mt-1.5 text-[12.5px] text-red-500 font-medium">{nameTaken}</p>}
        </div>

        {/* Automation answering the template's buttons */}
        <FlowPicker template={template} flowId={flowId} onChange={onFlowChange} />

        {/* Campaign category — the business purpose, used to filter and report */}
        <div>
          <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Category</label>
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_CATEGORIES.map((c) => {
              const active = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onCategoryChange(c.value)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? `${CAMPAIGN_CATEGORY_COLORS[c.value]} border-current`
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          {!category && <p className="text-[12px] text-gray-400 mt-1.5">Pick a category before sending.</p>}
        </div>

        {/* Template */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Template</p>
            <button onClick={() => onGoStep(1)} className="text-[12px] font-medium text-brand-fg hover:underline cursor-pointer">Change</button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[15px] font-semibold text-gray-800">{template.name}</p>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[template.category] ?? "bg-gray-100 text-gray-500"}`}>
              {CATEGORY_LABELS[template.category] ?? template.category}
            </span>
          </div>
          <WaBubble template={template} sampleName={sampleName} />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {extractVars(template.body).map((v) => (
              <span key={v} className="text-[11px] font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md">{v}</span>
            ))}
          </div>
        </div>

        {/* Recipients */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Recipients</p>
            <button onClick={() => onGoStep(2)} className="text-[12px] font-medium text-brand-fg hover:underline cursor-pointer">Edit</button>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[32px] font-bold text-gray-900 leading-none">{count}</p>
            <p className="text-[13px] text-gray-500">contacts will receive this message</p>
          </div>
          {tagSummary && <p className="text-[12px] text-gray-400 mt-1">{tagSummary}</p>}

          {/* Provenance. An approver signing off on a send should be able to
              read WHY these people were chosen, not just how many there are —
              a headcount alone is unreviewable. */}
          {segmentAudience && (
            <div className="mt-3 rounded-xl bg-brand-100 border border-brand/15 px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-fg shrink-0" />
                <p className="text-[12px] font-semibold text-brand-fg">
                  Segment · {segmentAudience.name}
                </p>
              </div>
              <p className="text-[11.5px] text-brand-fg/85 leading-relaxed">
                {(segmentAudience.definition?.rules ?? [])
                  .map((r) => describeRule(r, null))
                  .join(segmentAudience.definition?.match === "ANY" ? " or " : " and ")}
                .
              </p>
              <p className="text-[11px] text-brand-fg/70 mt-1.5 pt-1.5 border-t border-brand/10">
                Re-checked and frozen on the server when this campaign is created, so the
                approved count is the sent count.
              </p>
            </div>
          )}
          <div className="flex gap-1 mt-3">
            {selectedCustomers.slice(0, 6).map((c) => (
              <div key={c.id} className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center" title={c.name || ""}>
                <span className="text-[10px] font-bold text-brand-fg">{initials(c.name)}</span>
              </div>
            ))}
            {count > 6 && (
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                <span className="text-[10px] font-medium text-gray-500">+{count - 6}</span>
              </div>
            )}
          </div>
        </div>

        {/* When to send */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-3">
            {canSend ? "When to send" : "Proposed send time"}
          </p>
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setSendMode("now")}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors border cursor-pointer ${
                sendMode === "now"
                  ? "bg-brand-100 border-brand text-brand-fg"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {canSend ? "Send now" : "As soon as approved"}
            </button>
            <button
              type="button"
              onClick={() => setSendMode("later")}
              className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors border cursor-pointer ${
                sendMode === "later"
                  ? "bg-brand-100 border-brand text-brand-fg"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-800"
              }`}
            >
              {canSend ? "Schedule for later" : "Propose a time"}
            </button>
          </div>
          {sendMode === "later" && (
            <div className="space-y-2">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Time</label>
                <input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 flex items-center gap-1">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/></svg>
              Time is in <span className="font-medium text-gray-500">{schedTz.replace(/_/g, " ")}</span> — auto-detected from your device
            </p>
            {!canSend && (
              <p className="text-[11px] text-gray-400">
                If it&apos;s approved after this time, it sends straight away instead.
              </p>
            )}
            {scheduleInQuiet && quietHours && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="text-[12px] text-red-700">
                  <p>
                    {formatClock(scheduledAt!, schedTz)} is inside quiet hours ({quietHours.start}–{quietHours.end}{" "}
                    {quietHours.timezone.replace(/_/g, " ")}). Customers won&apos;t get messages then.
                  </p>
                  <button
                    type="button"
                    onClick={applyFirstAllowedTime}
                    className="mt-1.5 font-semibold underline hover:no-underline cursor-pointer"
                  >
                    Use {formatClock(nextOpenAfter(new Date(scheduledAt!), quietHours), schedTz)} instead
                  </button>
                </div>
              </div>
            )}
            </div>
          )}
          {nowInQuiet && quietHours && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 mt-2">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800">
                Quiet hours ({quietHours.start}–{quietHours.end}). Sending will start at{" "}
                <span className="font-semibold">{formatClock(quietHours.nextOpenAt)}</span>.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-[300px] border-l border-gray-100 bg-white p-5 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Send Summary</p>
        <div className="space-y-2.5 text-[13px]">
          {[
            { label: "Recipients", value: String(count) },
            { label: "Template", value: template.name },
            { label: "Estimated runtime", value: `≈ ${formatDuration(estimatedSecondsMin)}–${formatDuration(estimatedSecondsMax)}` },
            { label: canSend ? "Start" : "Proposed start", value: startDisplay },
            // No finish time to estimate until someone approves it.
            ...(canSend || sendMode === "later"
              ? [{ label: "ETA finish", value: etaFinishMin === etaFinishMax ? etaFinishMin : `${etaFinishMin} – ${etaFinishMax}` }]
              : []),
            { label: "Per-message cost", value: `$${rate.toFixed(4)}` },
            { label: "Estimated total", value: `$${estimatedCost}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between items-start gap-2">
              <span className="text-gray-500 shrink-0">{label}</span>
              <span className="font-medium text-gray-800 text-right">{value}</span>
            </div>
          ))}
        </div>

        <TierWarning verdict={assessTier(tier, count)} />

        <div className="bg-brand-100 rounded-xl p-3">
          <p className="text-[12px] text-brand-fg">
            <span className="font-semibold">Rate-limited:</span> messages send in small batches (~{SEND_SEC_PER_MSG_MIN.toFixed(1)}–{SEND_SEC_PER_MSG_MAX.toFixed(1)}s/msg effective) to keep your number trusted.
          </p>
        </div>

        <TestSendBox template={template} />

        <div className="mt-auto space-y-2">
          {!canSend && (
            <p className="text-[11px] text-gray-400 leading-relaxed">
              An admin reviews it before anything goes out. You can&apos;t edit it while it waits.
            </p>
          )}
          <button
            onClick={() => onSubmit(scheduledAt)}
            disabled={submitting || !campaignName.trim() || !category || scheduleInQuiet || (sendMode === "later" && (!schedDate || !schedTime))}
            className="w-full py-3 rounded-xl text-[14px] font-semibold text-white bg-brand hover:bg-[#2f5540] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {!canSend
              ? "Submit for approval"
              : sendMode === "now"
              ? "Send now"
              : schedDate && schedTime
              ? `Schedule for ${new Date(`${schedDate}T${schedTime}`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${new Date(`${schedDate}T${schedTime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function NewCampaignLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-white">
      <svg className="w-10 h-10 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}

export default function NewCampaignPage() {
  // A direct visit has to be turned away here too — otherwise someone without
  // access fills in the whole three-step wizard and only discovers it on the
  // 403 at save. Building needs campaign:write; the last step then sends
  // (campaign:send) or submits for approval (everyone else). Read from the
  // server's permission list, never the role name.
  const { ready, can } = useCurrentUser();
  const access: "checking" | "granted" | "denied" = !ready
    ? "checking"
    : can("campaign:write")
      ? "granted"
      : "denied";

  if (access === "checking") return <NewCampaignLoading />;

  if (access === "denied") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Lock className="w-10 h-10 text-gray-300" />
        <h1 className="text-lg font-semibold text-gray-500">No access</h1>
        <p className="text-[13px] text-gray-400">Only admins and the marketing team can create campaigns.</p>
      </div>
    );
  }

  return (
    <Suspense fallback={<NewCampaignLoading />}>
      <NewCampaignContent />
    </Suspense>
  );
}

function NewCampaignContent() {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");
  const [draftCampaignId, setDraftCampaignId] = useState<number | null>(
    draftIdParam ? parseInt(draftIdParam) : null
  );

  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  // Recipients can be pre-seeded from the Customers page via ?recipients=1,2,3.
  // The draft flow (?draft=ID) owns selection itself, so it takes precedence.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    const raw = searchParams.get("recipients");
    if (draftIdParam || !raw) return new Set();
    return new Set(
      raw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
    );
  });
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Warn before a number switch discards this wizard. The audience here is
  // resolved against the active number and the template belongs to its WABA, so
  // switching mid-flow would otherwise build a campaign pairing one number's
  // recipients with another number's template.
  const { registerSwitchGuard } = useActiveNumber();
  const wizardDirty = step > 1 || selectedIds.size > 0 || selectedTemplate !== null;
  useEffect(
    () =>
      registerSwitchGuard("campaign-wizard", () =>
        wizardDirty ? "This campaign draft will be discarded." : null,
      ),
    [registerSwitchGuard, wizardDirty],
  );
  // When set, the campaign is sent as a RULE rather than a list of ids: the
  // server re-resolves the segment at creation and freezes the result. The ids
  // in selectedIds are still tracked so the wizard can show a live count, a
  // tier warning and a cost estimate, but they are not what gets submitted.
  const [segmentAudience, setSegmentAudience] = useState<Segment | null>(null);
  // Which lists the user explicitly turned on — tracked separately from
  // selectedIds so two lists sharing contacts don't fight over each other's
  // toggle state (turning list B "on" just because list A already selected
  // the same people, or turning both off when only one is unchecked). Kept
  // here, not in Step 2, because the save sends them as audienceLists: where
  // the recipients came from, which the Marketing dashboard groups by.
  const [selectedListIds, setSelectedListIds] = useState<Set<number>>(new Set());
  const [listMembersCache, setListMembersCache] = useState<Record<number, number[]>>({});
  const [convMap, setConvMap] = useState<Map<number, Conversation>>(new Map());
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  // Campaign names are unique (case-insensitive). A CAMPAIGN_NAME_TAKEN answer
  // from any save lands here; the wizard goes to the review step (where the
  // name field is) and focuses it.
  const [nameTaken, setNameTaken] = useState<string | null>(null);
  const [focusNameTick, setFocusNameTick] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const changeCampaignName = (v: string) => {
    setCampaignName(v);
    setNameTaken(null);
  };
  const showNameTaken = (err: unknown) => {
    if (!(err instanceof ApiError && err.code === "CAMPAIGN_NAME_TAKEN")) return false;
    setNameTaken(err.message);
    setStep(3);
    setFocusNameTick((t) => t + 1);
    return true;
  };
  useEffect(() => {
    if (focusNameTick) nameInputRef.current?.focus();
  }, [focusNameTick]);
  const [category, setCategory] = useState<CampaignCategory | null>(null);
  const [flowId, setFlowId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(!!draftIdParam);
  const { can } = useCurrentUser();
  const canSend = can("campaign:send");
  const canReadChats = can("conversation:read");
  // From the loaded draft: its proposed time, and why it was sent back (if it was).
  const [draftScheduledAt, setDraftScheduledAt] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  // Set when Send now answered OVER_MESSAGING_LIMIT; confirming retries the
  // send alone — the campaign is already saved.
  const [overLimit, setOverLimit] = useState<{ campaignId: number; capacity: CampaignCapacity } | null>(null);
  // undefined = not loaded yet / unknown; null = Meta reported no tier.
  const [tier, setTier] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    apiGetWhatsAppStatus()
      .then((res) => setTier(res.data.messagingLimitTier))
      .catch(() => setTier(undefined));
  }, []);

  const sampleName = customers[0]?.name || "Sample Customer";

  // Load draft if ?draft=ID is in the URL
  useEffect(() => {
    if (!draftCampaignId) return;
    apiGetCampaign(draftCampaignId)
      .then((res) => {
        const c = res.data;
        setCampaignName(c.name);
        setCategory(c.category);
        setFlowId(c.flowId ?? null);
        setDraftScheduledAt(c.scheduledAt ?? null);
        setRejectionReason(c.rejectionReason ?? null);
        if (c.template) {
          setSelectedTemplate(c.template as unknown as Template);
        }
        // The lists a saved draft was picked from (its audience snapshot).
        const snap = (c as { audienceSnapshot?: { source?: string; lists?: { id: number }[] } | null }).audienceSnapshot;
        if (snap?.source === "LIST" && Array.isArray(snap.lists)) {
          setSelectedListIds(new Set(snap.lists.map((l) => l.id).filter((id) => Number.isInteger(id))));
        }
        if (c.recipients && c.recipients.length > 0) {
          setSelectedIds(new Set((c.recipients as { customerId: number }[]).map((r) => r.customerId)));
          setStep(3);
        } else if (c.template) {
          setStep(2);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDraft(false));
  }, [draftCampaignId]);

  // One-time confirmation that recipients were carried over from the Customers page.
  const notifiedSeedRef = useRef(false);
  useEffect(() => {
    if (notifiedSeedRef.current || draftIdParam) return;
    if (selectedIds.size > 0 && searchParams.get("recipients")) {
      notifiedSeedRef.current = true;
      toast.info(`${selectedIds.size} recipient${selectedIds.size !== 1 ? "s" : ""} carried over from Customers.`);
    }
  }, [draftIdParam, selectedIds, searchParams, toast]);

  // Seed recipients from an entire list via ?listId=ID (e.g. the "Create
  // Campaign" button on a Lists page). The draft flow owns selection, so skip.
  const seededListRef = useRef(false);
  useEffect(() => {
    const listIdParam = searchParams.get("listId");
    if (seededListRef.current || draftIdParam || !listIdParam) return;
    seededListRef.current = true;
    apiGetListMemberIds(listIdParam)
      .then((res) => {
        setSelectedIds((prev) => new Set([...prev, ...res.data.customerIds]));
        const seedId = Number(listIdParam);
        if (Number.isInteger(seedId)) {
          setListMembersCache((prev) => ({ ...prev, [seedId]: res.data.customerIds }));
          setSelectedListIds((prev) => new Set(prev).add(seedId));
        }
        toast.info(`${res.data.customerIds.length} recipient${res.data.customerIds.length !== 1 ? "s" : ""} carried over from "${res.data.name}".`);
      })
      .catch(() => toast.error("Couldn't load that list's contacts."));
  }, [draftIdParam, searchParams, toast]);

  // Seed the audience from an entire segment via ?segmentId=ID (the "Create
  // Campaign" button on a segment card). The draft flow owns selection, so skip.
  const seededSegmentRef = useRef(false);
  useEffect(() => {
    const segmentIdParam = searchParams.get("segmentId");
    if (seededSegmentRef.current || draftIdParam || !segmentIdParam) return;
    seededSegmentRef.current = true;
    Promise.all([apiGetSegment(segmentIdParam), apiGetSegmentMemberIds(segmentIdParam)])
      .then(([seg, members]) => {
        setSegmentAudience(seg.data);
        setSelectedIds(new Set(members.data.customerIds));
        toast.info(
          `Targeting "${seg.data.name}" — ${members.data.count.toLocaleString()} contact${members.data.count !== 1 ? "s" : ""} right now.`
        );
      })
      .catch(() => toast.error("Couldn't load that segment."));
  }, [draftIdParam, searchParams, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const PAGE = 100; // backend caps page size at 100
      const MAX_PAGES = 50; // safety cap → up to 5,000 recipients loaded
      try {
        // Load ALL customers across pages — otherwise recipients past the first
        // page are silently unreachable and "Select all" would under-select.
        const firstCust = await apiGetCustomers(1, PAGE);
        const custItems = [...firstCust.data];
        const custPages = Math.min(firstCust.pagination.totalPages, MAX_PAGES);
        if (custPages > 1) {
          const rest = await Promise.all(
            Array.from({ length: custPages - 1 }, (_, i) => apiGetCustomers(i + 2, PAGE))
          );
          rest.forEach((r) => custItems.push(...r.data));
        }

        // Conversations (also paged) power the last-activity column and Lapsed
        // filter — only for people with inbox access (not MARKETING).
        const firstConv = canReadChats
          ? await apiGetConversations(1, PAGE)
          : { data: [] as Conversation[], pagination: { totalPages: 0 } };
        const convItems = [...firstConv.data];
        const convPages = Math.min(firstConv.pagination.totalPages, MAX_PAGES);
        if (convPages > 1) {
          const rest = await Promise.all(
            Array.from({ length: convPages - 1 }, (_, i) => apiGetConversations(i + 2, PAGE))
          );
          rest.forEach((r) => convItems.push(...r.data));
        }

        if (cancelled) return;
        setCustomers(custItems);
        const map = new Map<number, Conversation>();
        convItems.forEach((conv) => {
          if (conv.customerId != null) map.set(Number(conv.customerId), conv);
        });
        setConvMap(map);

        if (firstCust.pagination.total > custItems.length) {
          toast.info(
            `Showing ${custItems.length} of ${firstCust.pagination.total} contacts. Use search or tags to reach the rest.`
          );
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load contacts. Please refresh and try again.");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, canReadChats]);

  useEffect(() => {
    if (selectedTemplate && !campaignName) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const suggested = `${selectedTemplate.name} · ${today}`;
      setCampaignName(suggested);
      // Names are unique: if today's default is already used, take the first
      // free "… (2)", "… (3)" — unless the user has typed their own meanwhile.
      apiCampaignNameAvailable(suggested)
        .then((res) => {
          if (!res.data.available) setCampaignName((cur) => (cur === suggested ? res.data.suggestion : cur));
        })
        .catch(() => {});
    }
  }, [selectedTemplate, campaignName]);

  // Hand-editing the selection has to break the segment link, or the payload
  // would still send segmentId and the server would re-resolve the rule —
  // silently discarding the edit the user just made.
  const handleToggle = (id: number) => {
    setSegmentAudience(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleToggleAll = (ids: number[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => select ? next.add(id) : next.delete(id));
      return next;
    });
  };

  // The ticked lists that still contribute someone to the selection (hand
  // edits may have removed a list's members). A list whose members aren't
  // loaded here (restored from a draft) is sent as is — the server leaves out
  // any list none of the recipients belong to.
  const audienceListIds = () =>
    [...selectedListIds].filter((id) => {
      const members = listMembersCache[id];
      return !members || members.some((m) => selectedIds.has(m));
    });

  const handleSaveDraft = async () => {
    if (!selectedTemplate) {
      router.push("/campaigns");
      return;
    }
    setSavingDraft(true);
    try {
      // A segment campaign sends the rule, not the ids — see segmentAudience.
      const payload = segmentAudience
        ? {
            name: campaignName || `${selectedTemplate.name} · Draft`,
            templateId: selectedTemplate.id,
            segmentId: segmentAudience.id,
            flowId,
            ...(category && { category }),
          }
        : {
            name: campaignName || `${selectedTemplate.name} · Draft`,
            templateId: selectedTemplate.id,
            recipientIds: [...selectedIds],
            audienceLists: audienceListIds(),
            flowId,
            ...(category && { category }),
          };
      if (draftCampaignId) {
        await apiUpdateCampaign(draftCampaignId, payload);
      } else {
        await apiCreateCampaign(payload);
      }
      toast.success("Draft saved.");
      router.push("/campaigns");
    } catch (err) {
      if (showNameTaken(err)) return;
      toast.error(err instanceof Error ? err.message : "Couldn't save draft. Please try again.");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async (scheduledAt?: string) => {
    if (!selectedTemplate || submitting) return;
    setSubmitting(true);
    try {
      const baseName = campaignName || `${selectedTemplate.name} · ${new Date().toLocaleDateString()}`;
      const payload = segmentAudience
        ? { name: baseName, templateId: selectedTemplate.id, segmentId: segmentAudience.id, scheduledAt, flowId, ...(category && { category }) }
        : { name: baseName, templateId: selectedTemplate.id, recipientIds: [...selectedIds], audienceLists: audienceListIds(), scheduledAt, flowId, ...(category && { category }) };
      let campaignId: number;
      if (draftCampaignId) {
        // null, not undefined: switching back to "now" has to clear a time
        // saved earlier, or approval would still schedule it for then.
        await apiUpdateCampaign(draftCampaignId, { ...payload, scheduledAt: scheduledAt ?? null });
        campaignId = draftCampaignId;
      } else {
        const res = await apiCreateCampaign(payload);
        campaignId = res.data.id;
        // If the send below fails, a retry must reuse this campaign, not
        // create a second one.
        setDraftCampaignId(campaignId);
      }
      // No campaign:send — the server kept it a DRAFT (proposed time and all);
      // hand it to an admin. A failure here (no recipients, template paused…)
      // leaves the saved draft for the retry above to update.
      if (!canSend) {
        await apiSubmitCampaign(campaignId);
        toast.success("Submitted for approval");
        router.push("/campaigns");
        return;
      }
      if (!scheduledAt) {
        try {
          await apiSendCampaignNow(campaignId);
        } catch (err) {
          const capacity = overLimitDetails(err);
          if (!capacity) throw err;
          setOverLimit({ campaignId, capacity });
          return;
        }
      }
      toast.success(scheduledAt ? "Campaign scheduled." : "Campaign is sending now.");
      router.push("/campaigns");
    } catch (err) {
      if (showNameTaken(err)) return;
      toast.error(
        err instanceof Error
          ? err.message
          : canSend
          ? "Failed to send campaign. Please try again."
          : "Couldn't submit campaign. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirmOverLimitSend = async () => {
    if (!overLimit) return;
    setSubmitting(true);
    try {
      await apiSendCampaignNow(overLimit.campaignId, { confirmOverLimit: true });
      setOverLimit(null);
      toast.success("Campaign is sending now.");
      router.push("/campaigns");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send campaign. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { n: 1, label: "Template" },
    { n: 2, label: "Recipients" },
    { n: 3, label: "Review & schedule" },
  ];

  const canProceed1 = !!selectedTemplate;
  const canProceed2 = selectedIds.size > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <div className="shrink-0 border-b border-gray-100 px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/campaigns")}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-[15px] font-semibold text-gray-800">New campaign</span>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {steps.map(({ n, label }, i) => (
            <div key={n} className="flex items-center gap-2">
              <StepDot
                n={n}
                label={label}
                state={step > n ? "done" : step === n ? "active" : "pending"}
              />
              {i < steps.length - 1 && (
                <div className="w-8 h-px bg-gray-200" />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveDraft}
          disabled={savingDraft}
          className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
        >
          {savingDraft ? "Saving…" : "Save draft"}
        </button>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {loadingDraft ? (
          <div className="flex-1 flex items-center justify-center">
            <svg className="w-10 h-10 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
        ) : (
          <>
            {step === 1 && (
              <Step1
                selected={selectedTemplate}
                onSelect={setSelectedTemplate}
                sampleName={sampleName}
              />
            )}
            {step === 2 && (
              <Step2
                selectedIds={selectedIds}
                onToggle={handleToggle}
                onToggleAll={handleToggleAll}
                customers={customers}
                convMap={convMap}
                loading={loadingCustomers}
                template={selectedTemplate}
                tier={tier}
                segmentAudience={segmentAudience}
                onPickSegment={setSegmentAudience}
                selectedListIds={selectedListIds}
                setSelectedListIds={setSelectedListIds}
                listMembersCache={listMembersCache}
                setListMembersCache={setListMembersCache}
              />
            )}
            {step === 3 && selectedTemplate && (
              <Step3
                template={selectedTemplate}
                segmentAudience={segmentAudience}
                selectedIds={selectedIds}
                customers={customers}
                campaignName={campaignName}
                onNameChange={changeCampaignName}
                nameTaken={nameTaken}
                nameInputRef={nameInputRef}
                category={category}
                onCategoryChange={setCategory}
                flowId={flowId}
                onFlowChange={setFlowId}
                onGoStep={setStep}
                onSubmit={handleSubmit}
                submitting={submitting}
                tier={tier}
                canSend={canSend}
                initialScheduledAt={draftScheduledAt}
                rejectionReason={rejectionReason}
              />
            )}
          </>
        )}
      </div>

      {/* Footer nav (steps 1 & 2) */}
      {!loadingDraft && step < 3 && (
        <div className="shrink-0 border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-white">
          <button
            onClick={() => (step === 1 ? router.push("/campaigns") : setStep(step - 1))}
            className="text-[13px] font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-5 py-2.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? "Cancel" : "Back"}
          </button>
          <button
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !canProceed1) || (step === 2 && !canProceed2)}
            className="text-[13px] font-semibold text-white bg-brand hover:bg-[#2f5540] disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            {step === 1 ? "Continue → Recipients" : "Review →"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {overLimit && (
        <OverLimitDialog
          capacity={overLimit.capacity}
          actionLabel="Send anyway"
          busy={submitting}
          onCancel={() => setOverLimit(null)}
          onConfirm={confirmOverLimitSend}
        />
      )}
    </div>
  );
}
