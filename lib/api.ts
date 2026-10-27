import type {
  LoginResponse,
  ConversationListResponse,
  MessagesResponse,
  SendMessageResponse,
  Customer,
  CustomerListResponse,
  CustomerResponse,
  AuditLogResponse,
  Gender,
  ContactListListResponse,
  ContactListResponse,
  ContactListDetailResponse,
} from "@/types";

// Optional patient/demographic fields shared by create & update.
type CustomerPatientFields = {
  chartNumber?: string | null;
  nationality?: string | null;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  joinDate?: string | null;
  departments?: string[];
};

const BASE = process.env.NEXT_PUBLIC_API_URL;

// Sent on EVERY request. The API refuses a state-changing call without it
// (middleware/csrf.js): another site can't add a custom header without a CORS
// preflight, which the API only grants to this app's origin.
const CSRF_HEADER = { "X-Requested-With": "XMLHttpRequest" } as const;

// Carries the HTTP status alongside the message so callers can distinguish
// "forbidden" (403) from "upstream service failed" (502) from any other
// error, instead of only having a message string to guess from.
export class ApiError extends Error {
  status: number;
  /** The server's machine-readable reason, e.g. "WINDOW_CLOSED", when it sent one. */
  code?: string;
  /** Structured context from the server, e.g. { field: "header" } for a Meta template rejection. */
  details?: { field?: string | null; [k: string]: unknown };
  constructor(message: string, status: number, code?: string, details?: ApiError["details"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// One expired session makes every in-flight request 401 at once — the
// dashboard alone fires /users/me, /stats/overview and /conversations on
// mount. Latched once so only the first of them tears down the session and
// navigates, instead of three racing redirects.
let sessionExpired = false;

// ── Active WhatsApp number ──────────────────────────────────────────────────
//
// apiFetch is module scope and cannot use hooks, so the selected number lives
// here and WhatsAppNumberProvider pushes it in. Same pattern as the
// sessionExpired latch above.
//
// `numberEpoch` and `numberAbort` are what make switching safe. Neither alone is
// enough: abort() does nothing to a fetch whose response has ALREADY resolved
// and is sitting in the microtask queue, while an epoch check alone lets the
// request finish and waste the round trip. Together they close both gaps, and
// because both live here rather than in ~30 call sites, there is nothing for a
// future page to forget.
let activeNumberId: string | null = null;
let numberEpoch = 0;
let numberAbort = new AbortController();

export function getActiveNumber(): string | null {
  return activeNumberId;
}

/**
 * Point every subsequent request at a different WhatsApp number, and cut off
 * every request already in flight for the previous one.
 *
 * MUST be called synchronously from the switch handler, BEFORE the React state
 * update that remounts the dashboard. If it ran in an effect instead, the
 * remounted children's effects would fire first and fetch under the OLD number.
 */
export function setActiveNumber(id: string | null): void {
  if (id === activeNumberId) return;
  activeNumberId = id;
  numberEpoch++;
  numberAbort.abort();
  numberAbort = new AbortController();
}

// A promise that never settles. Returned when a response belongs to a number the
// user has already switched away from.
//
// Deliberately not a rejection: every existing `.catch(err => setError(...))` in
// the app would paint "The user aborted a request" into a visible error banner on
// every single switch, which would mean auditing and patching a dozen catch
// blocks. A promise that never settles runs no .then, no .catch and no .finally,
// so no state is written and no call site changes. The pending promises are
// collected when the key-remount in the dashboard layout unmounts their owners.
//
// If this looks like a bug: it is load-bearing. See WhatsAppNumberProvider.
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * @param numberScoped  true (default) for anything whose answer depends on the
 *   active WhatsApp number: such a request is cut off the moment the user
 *   switches, so the previous number's data can never land. Pass false for a
 *   request that has nothing to do with numbers AND whose result is held above
 *   the dashboard's remount boundary — /users/me above all. A number-scoped
 *   request that is cut off never settles, so if /users/me were one, the first
 *   automatic number selection after login would leave the app waiting forever
 *   for a user that never arrives (empty sidebar, endless spinner).
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  { numberScoped = true }: { numberScoped?: boolean } = {},
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  // Auth calls are carved out: sending a number during login is a chicken-and-egg,
  // and the same carve-out already exists for the 401 handling below.
  const isAuthCall = path.startsWith("/api/auth/");
  const headers: Record<string, string> = {
    ...CSRF_HEADER,
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    // Outside the isFormData ternary so uploads carry it too, and BEFORE
    // options.headers so a caller can deliberately override it for the rare
    // "ask about a specific number" call.
    ...(activeNumberId && !isAuthCall ? { "X-WhatsApp-Number-Id": activeNumberId } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const epochAtStart = numberEpoch;
  // A number switch changing mid-flight only invalidates number-scoped answers.
  const switchedAway = () => numberScoped && epochAtStart !== numberEpoch;
  const signal = !numberScoped
    ? options.signal ?? undefined
    : options.signal
      ? AbortSignal.any([numberAbort.signal, options.signal])
      : numberAbort.signal;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers, signal, credentials: "include" });
  } catch (err) {
    // An abort from a number switch is not an error the UI should ever see, and
    // must never trip the session-expired latch below.
    if (switchedAway() || (numberScoped && err instanceof DOMException && err.name === "AbortError")) {
      return neverSettles<T>();
    }
    throw err;
  }

  // The request completed, but the user switched while it was in flight.
  if (switchedAway()) return neverSettles<T>();

  // Belt and braces: the server echoes the number it actually scoped the query
  // to. A mismatch means an endpoint ignored the header — a class of bug the
  // client is otherwise completely blind to.
  if (process.env.NODE_ENV !== "production" && !isAuthCall && numberScoped) {
    const echoed = res.headers.get("X-WhatsApp-Number-Id");
    if (echoed && activeNumberId && echoed !== "all" && echoed !== activeNumberId) {
      console.error(
        `[whatsapp-number] ${path} was scoped to number ${echoed} but ${activeNumberId} is active — ` +
        "the endpoint is ignoring X-WhatsApp-Number-Id.",
      );
      return neverSettles<T>();
    }
  }

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    if (!sessionExpired) {
      sessionExpired = true;
      localStorage.removeItem("user");
      document.cookie = "logged_in=; path=/; max-age=0";
      // Deliberately no logout POST: the token the server would clear has
      // already been rejected, so there is nothing for it to do.
      //
      // `expired` tells proxy.ts to leave us on the login page even if the
      // cookie clear above didn't stick, so this can't become a loop.
      window.location.href = "/login?expired=1";
    }
    throw new Error("Session expired");
  }

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new ApiError(data?.message ?? `HTTP ${res.status}`, res.status, data?.code, data?.details);
  }

  return data as T;
}

export function apiLogin(username: string, password: string) {
  return apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function apiGetConversations(
  page = 1,
  limit = 50,
  lastSenderType?: string,
  search?: string,
  view: import("@/types").ConversationView = "all",
) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (lastSenderType) params.append("lastSenderType", lastSenderType);
  if (search) params.append("search", search);
  if (view !== "all") params.append("view", view);
  return apiFetch<ConversationListResponse>(`/api/conversations?${params}`);
}

/** The numbers on the inbox's view tabs (Mine / Unassigned / Campaign replies / Follow-ups). */
export function apiGetConversationCounts() {
  return apiFetch<{ success: boolean; data: import("@/types").ConversationCounts }>("/api/conversations/counts");
}

/** Who a conversation can be assigned to. Open to anyone who can assign, agents included. */
export function apiGetAssignableUsers() {
  return apiFetch<{ success: boolean; data: import("@/types").AssignableUser[] }>("/api/users/assignable");
}

export function apiGetMessages(conversationId: string, page = 1, limit = 200) {
  return apiFetch<MessagesResponse>(
    `/api/conversations/${conversationId}/messages?page=${page}&limit=${limit}`
  );
}

// Everything the chat's contact panel shows, in one request.
export function apiGetConversationProfile(conversationId: string) {
  return apiFetch<{ success: boolean; data: import("@/types").ConversationProfile }>(`/api/conversations/${conversationId}/profile`);
}

// Shows "typing…" to the customer (and blue-ticks their latest message).
// The server throttles it; callers can fire it freely while the agent types.
export function apiSendTyping(conversationId: string) {
  return apiFetch<{ success: boolean; sent: boolean }>(`/api/conversations/${conversationId}/typing`, { method: "POST" });
}

export function apiMarkRead(conversationId: string) {
  return apiFetch<{ success: boolean }>(
    `/api/conversations/${conversationId}/read`,
    { method: "POST" }
  );
}

export function apiDeleteMessage(messageId: string | number) {
  return apiFetch<{ success: boolean }>(`/api/messages/${messageId}`, { method: "DELETE" });
}

export function apiGetCustomer(id: string) {
  return apiFetch<{ success: boolean; data: Customer }>(`/api/customers/${id}`);
}

export function apiSendMessage(
  conversationId: string,
  content: string,
  mediaUrl?: string,
  messageType: import("@/types").Message["messageType"] = "TEXT",
  quotedMessageId?: number | null,
  // clientMessageId: the same id on a retry/double-click returns the first send
  // instead of sending twice. confirmOtherOwner: "reply anyway" in a chat a
  // colleague owns.
  opts: { clientMessageId?: string; confirmOtherOwner?: boolean } = {},
) {
  return apiFetch<SendMessageResponse>("/api/messages/send", {
    method: "POST",
    body: JSON.stringify({
      conversationId: Number(conversationId),
      content,
      messageType,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(quotedMessageId ? { quotedMessageId } : {}),
      ...opts,
    }),
  });
}

export function apiUploadMedia(file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<{
    success: boolean;
    url: string;
    publicId: string;
    messageType: import("@/types").Message["messageType"];
    format: string;
    bytes: number;
  }>("/api/media/upload", { method: "POST", body: form });
}

// Media Library
export function apiGetMediaLibrary(type?: import("@/types").MediaAssetType) {
  return apiFetch<import("@/types").MediaAssetListResponse>(
    `/api/media-library${type ? `?type=${type}` : ""}`
  );
}

export function apiUploadToMediaLibrary(file: File, name?: string) {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  return apiFetch<import("@/types").MediaAssetResponse>("/api/media-library", { method: "POST", body: form });
}

export function apiUpdateMediaAsset(id: number, data: { filename: string }) {
  return apiFetch<import("@/types").MediaAssetResponse>(`/api/media-library/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiDeleteMediaAsset(id: number) {
  return apiFetch<{ success: boolean; message: string }>(`/api/media-library/${id}`, { method: "DELETE" });
}

// `seen`: the owner this screen showed. If someone changed it since, the
// server refuses (409 ASSIGNMENT_CHANGED) instead of silently overwriting.
export function apiAssignConversation(conversationId: string, agentId: number | null, seen?: { agentId: number | null }) {
  return apiFetch<{ success: boolean }>(
    `/api/conversations/${conversationId}/assign`,
    {
      method: "PUT",
      body: JSON.stringify({ agentId, ...(seen ? { expectedAgentId: seen.agentId } : {}) }),
    }
  );
}

export function apiChangeConversationStatus(
  conversationId: string,
  status: "OPEN" | "PENDING" | "RESOLVED"
) {
  return apiFetch<{ success: boolean }>(
    `/api/conversations/${conversationId}/status`,
    {
      method: "PUT",
      body: JSON.stringify({ status }),
    }
  );
}

export function apiDeleteCustomer(id: string | number) {
  return apiFetch<{ success: boolean; message: string }>(`/api/customers/${id}`, { method: "DELETE" });
}

export function apiBulkDeleteCustomers(ids: number[]) {
  return apiFetch<{ success: boolean; message: string; data: { deleted: number } }>(
    "/api/customers/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) }
  );
}

type ImportIssue = { row: number; phone?: string; reason: string };

export function apiValidateImport(file: File, dateFormat = "auto", defaultCountry = "") {
  const form = new FormData();
  form.append("file", file);
  form.append("dateFormat", dateFormat);
  form.append("defaultCountry", defaultCountry);
  return apiFetch<{
    success: boolean;
    data: { total: number; valid: number; duplicates: ImportIssue[]; invalid: ImportIssue[] };
  }>("/api/customers/import/validate", { method: "POST", body: form });
}

export function apiImportCustomers(file: File, dateFormat = "auto", defaultCountry = "") {
  const form = new FormData();
  form.append("file", file);
  form.append("dateFormat", dateFormat);
  form.append("defaultCountry", defaultCountry);
  return apiFetch<{
    success: boolean;
    data: {
      total: number;
      created: number;
      skipped: number;
      duplicates?: ImportIssue[];
      errors: ImportIssue[];
    };
  }>("/api/customers/import", { method: "POST", body: form });
}

export function apiGetCustomers(page = 1, limit = 20, search = "") {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (search) {
    params.append("search", search);
  }
  return apiFetch<CustomerListResponse>(`/api/customers?${params.toString()}`);
}

export function apiCreateCustomer(data: {
  phone: string;
  name?: string;
  email?: string;
  tags?: string[];
  notes?: string;
} & CustomerPatientFields) {
  return apiFetch<CustomerResponse>("/api/customers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function apiUpdateCustomer(
  id: string | number,
  data: Partial<{ name: string; email: string; tags: string[]; notes: string; optedOut: boolean } & CustomerPatientFields>
) {
  return apiFetch<CustomerResponse>(`/api/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiSearchMessages(
  q: string,
  conversationId?: string,
  page = 1,
  limit = 20
) {
  const params = new URLSearchParams({
    q,
    page: String(page),
    limit: String(limit),
  });
  if (conversationId) {
    params.append("conversationId", conversationId);
  }
  return apiFetch<MessagesResponse>(`/api/messages/search?${params.toString()}`);
}

// ── Error log (admin) ──
export type ErrorLogQuery = { source?: string; status?: "open" | "resolved" | "all"; q?: string; page?: number };

export function apiGetErrorLog(query: ErrorLogQuery = {}) {
  const params = new URLSearchParams({ page: String(query.page ?? 1), limit: "25", status: query.status ?? "open" });
  if (query.source) params.set("source", query.source);
  if (query.q) params.set("q", query.q);
  // Not number-scoped: errors are workspace-wide.
  return apiFetch<import("@/types").ErrorLogResponse>(`/api/audit/errors?${params.toString()}`, {}, { numberScoped: false });
}

/** Open errors seen in the last 24 hours — the sidebar badge. */
export function apiGetErrorSummary() {
  return apiFetch<{ success: boolean; data: { recent: number } }>("/api/audit/errors/summary", {}, { numberScoped: false });
}

export function apiSetErrorResolved(id: number, resolved: boolean) {
  return apiFetch<{ success: boolean }>(`/api/audit/errors/${id}/${resolved ? "resolve" : "reopen"}`, { method: "POST" }, { numberScoped: false });
}

/** Resolves every open entry matching the filter (source / search). */
export function apiResolveAllErrors(filter: { source?: string; q?: string }) {
  return apiFetch<{ success: boolean; data: { count: number } }>(
    "/api/audit/errors/resolve-all",
    { method: "POST", body: JSON.stringify(filter) },
    { numberScoped: false },
  );
}

export function apiGetAuditLog(
  page = 1,
  limit = 20,
  action?: string,
  actorId?: number
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (action) {
    params.append("action", action);
  }
  if (actorId !== undefined) {
    params.append("actorId", String(actorId));
  }
  return apiFetch<AuditLogResponse>(`/api/audit?${params.toString()}`);
}

// User management (admin)
export function apiGetUsers(params?: { page?: number; limit?: number; search?: string; role?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.search) q.set("search", params.search);
  if (params?.role) q.set("role", params.role);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiFetch<import("@/types").UserListResponse>(`/api/users${qs ? "?" + qs : ""}`);
}

export function apiGetMe() {
  // Not number-scoped: who you are does not change with the selected number, and
  // CurrentUserProvider holds the result above the remount boundary. See apiFetch.
  return apiFetch<import("@/types").UserResponse>("/api/users/me", {}, { numberScoped: false });
}

export function apiGetUser(id: number | string) {
  return apiFetch<import("@/types").UserResponse>(`/api/users/${id}`);
}

export function apiCreateUser(data: { name?: string; username: string; password: string; role?: import("@/types").UserRole }) {
  return apiFetch<import("@/types").UserResponse>("/api/users", { method: "POST", body: JSON.stringify(data) });
}

/**
 * `isActive: false` deactivates (they're signed out and can't sign in). When
 * that — or a role change — takes away their inbox, their open chats go to
 * `handOverTo` (a user id), or back to the queue when it's null/omitted;
 * `handedOver` says what moved.
 */
export function apiUpdateUser(
  id: number | string,
  data: Partial<{
    name: string | null;
    username: string;
    role: import("@/types").UserRole;
    status: import("@/types").UserStatus;
    isActive: boolean;
    handOverTo: number | null;
  }>,
) {
  return apiFetch<import("@/types").UserResponse & { handedOver: import("@/types").HandOverResult | null }>(
    `/api/users/${id}`,
    { method: "PUT", body: JSON.stringify(data) },
  );
}

export function apiDeleteUser(id: number | string) {
  return apiFetch<{ success: boolean; message: string }>(`/api/users/${id}`, { method: "DELETE" });
}

export function apiResetUserPassword(id: number | string, password: string) {
  return apiFetch<{ success: boolean; message: string }>(`/api/users/${id}/password`, { method: "PUT", body: JSON.stringify({ password }) });
}

export function apiUpdateMyStatus(status: import("@/types").UserStatus) {
  return apiFetch<import("@/types").UserResponse>("/api/users/me/status", { method: "PUT", body: JSON.stringify({ status }) });
}

/** End of shift: my open chats to a colleague, or back to the queue (no id). */
export function apiHandOverMine(toUserId: number | null) {
  return apiFetch<{ success: boolean; data: import("@/types").HandOverResult }>("/api/users/me/hand-over", {
    method: "POST",
    body: JSON.stringify(toUserId ? { toUserId } : {}),
  }, { numberScoped: false });
}

/** Supervisor: move someone's open chats (they're off, absent…). */
export function apiSupervisionHandOver(fromUserId: number, toUserId: number | null) {
  return apiFetch<{ success: boolean; data: import("@/types").HandOverResult }>("/api/supervision/hand-over", {
    method: "POST",
    body: JSON.stringify({ fromUserId, ...(toUserId ? { toUserId } : {}) }),
  }, { numberScoped: false });
}

export function apiLogout() {
  return apiFetch<{ success: boolean }>("/api/auth/logout", { method: "POST" });
}

export function apiGetStatsOverview() {
  return apiFetch<import("@/types").StatsOverviewResponse>("/api/stats/overview");
}

export function apiGetStatsMessages(days = 7) {
  return apiFetch<import("@/types").StatsMessagesResponse>(`/api/stats/messages?days=${days}`);
}

export function apiGetStatsAgents() {
  return apiFetch<import("@/types").StatsAgentsResponse>("/api/stats/agents");
}

export function apiGetStatsConversations() {
  return apiFetch<{ success: boolean; data: unknown }>("/api/stats/conversations");
}

export function apiGetStatsCustomers() {
  return apiFetch<{ success: boolean; data: unknown }>("/api/stats/customers");
}

// Templates
export function apiGetTemplates(params?: { category?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.category) q.set("category", params.category);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return apiFetch<import("@/types").TemplateListResponse>(`/api/templates${qs ? "?" + qs : ""}`);
}

export function apiCreateTemplate(data: {
  name: string;
  category: import("@/types").TemplateCategory;
  language?: string;
  headerType?: import("@/types").TemplateHeaderType;
  header?: string;
  headerMediaUrl?: string;
  body: string;
  footer?: string;
  buttons?: import("@/types").TemplateButton[];
  cards?: import("@/types").TemplateCard[];
}) {
  return apiFetch<import("@/types").TemplateResponse>("/api/templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function apiUpdateTemplate(
  id: number,
  data: Partial<{
    name: string;
    category: import("@/types").TemplateCategory;
    language: string;
    headerType: import("@/types").TemplateHeaderType;
    header: string;
    headerMediaUrl: string;
    body: string;
    footer: string;
    buttons: import("@/types").TemplateButton[];
    // [] switches a carousel back to a standard template.
    cards: import("@/types").TemplateCard[];
  }>
) {
  return apiFetch<import("@/types").TemplateResponse>(`/api/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiDeleteTemplate(id: number) {
  return apiFetch<{ success: boolean }>(`/api/templates/${id}`, { method: "DELETE" });
}

export function apiSubmitTemplate(id: number) {
  return apiFetch<import("@/types").TemplateResponse>(`/api/templates/${id}/submit`, {
    method: "POST",
  });
}

export function apiSyncTemplates() {
  return apiFetch<{ success: boolean; updated: number; approved: number; rejected: number }>(
    "/api/templates/sync",
    { method: "POST" }
  );
}

// Reads the active line's templates from WhatsApp Manager. dryRun: only
// report what would happen (nothing is written).
export function apiImportTemplates(dryRun: boolean) {
  return apiFetch<import("@/types").TemplateImportResult>("/api/templates/import", {
    method: "POST",
    body: JSON.stringify({ dryRun }),
  });
}

// What each {{n}} of an imported template means, e.g. { "1": "first_name" }.
// The header has its own numbering (at most {{1}}).
export function apiMapTemplateVariables(
  id: number,
  mapping: Record<string, string>,
  headerMapping?: Record<string, string>,
) {
  return apiFetch<import("@/types").TemplateResponse>(`/api/templates/${id}/map-variables`, {
    method: "POST",
    body: JSON.stringify({ mapping, ...(headerMapping ? { headerMapping } : {}) }),
  });
}

// A media file of our own for an imported template (in place of Meta's
// expiring sample). cards: one entry per card; an empty mediaUrl keeps it.
export function apiSetTemplateMedia(id: number, data: { headerMediaUrl?: string; cards?: { mediaUrl: string }[] }) {
  return apiFetch<import("@/types").TemplateResponse>(`/api/templates/${id}/media`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Campaigns
export function apiGetCampaigns() {
  return apiFetch<import("@/types").CampaignListResponse>("/api/campaigns");
}

export function apiGetCampaign(id: number) {
  return apiFetch<import("@/types").CampaignResponse>(`/api/campaigns/${id}`);
}

/** A campaign's Replies worklist: who answered, and whether anyone has got back to them. */
export function apiGetCampaignReplies(id: number, page = 1, limit = 50) {
  return apiFetch<{
    success: boolean;
    data: import("@/types").CampaignReply[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }>(`/api/campaigns/${id}/replies?page=${page}&limit=${limit}`);
}

export interface ActiveCampaignProgress {
  id: number;
  status: "RUNNING" | "PAUSED";
  sentCount: number;
  failedCount: number;
  totalRecipients: number;
}

// Dev-only message/cost tracker (the API only mounts /api/dev outside production).
export function apiDevBilling(since?: string) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiFetch<{ success: boolean; data: import("@/components/DevCostTracker").DevBilling }>(
    `/api/dev/billing${qs}`, {}, { numberScoped: false },
  );
}

export function apiGetQuietHours() {
  return apiFetch<{ success: boolean; data: import("@/lib/quietHours").QuietHours }>("/api/campaigns/quiet-hours");
}

/** Whether a campaign name is free; `suggestion` is the first free "X", "X (2)"… (names are unique, case-insensitive). */
export function apiCampaignNameAvailable(name: string) {
  return apiFetch<{ success: boolean; data: { available: boolean; suggestion: string } }>(
    `/api/campaigns/name-available?name=${encodeURIComponent(name)}`,
  );
}

export function apiGetActiveCampaignProgress() {
  return apiFetch<{ success: boolean; data: ActiveCampaignProgress[] }>("/api/campaigns/active-progress");
}

export function apiCreateCampaign(data: {
  name: string;
  templateId: number;
  // Either a hand-picked list of ids, or a segment the server resolves and
  // freezes at creation. Passing segmentId is what makes the approved count
  // and the sent count the same number.
  recipientIds?: number[];
  // With recipientIds: the contact lists they were picked from (provenance
  // only — the Marketing dashboard groups campaigns by it).
  audienceLists?: number[];
  segmentId?: number;
  scheduledAt?: string;
  flowId?: number | null;
  category?: import("@/types").CampaignCategory;
}) {
  return apiFetch<import("@/types").CampaignResponse>("/api/campaigns", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Flows (campaign automations) ────────────────────────────────────────────
type FlowWrite = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  graph?: import("@/types").FlowGraph;
  // The version the editor loaded; a graph save based on an older one is refused (409 FLOW_CHANGED).
  baseUpdatedAt?: string;
};

export function apiGetFlows() {
  return apiFetch<{ success: boolean; data: import("@/types").FlowSummary[] }>("/api/campaigns/flows");
}

export function apiGetFlow(id: number) {
  return apiFetch<{ success: boolean; data: import("@/types").Flow }>(`/api/campaigns/flows/${id}`);
}

export function apiCreateFlow(data: FlowWrite & { name: string; graph: import("@/types").FlowGraph }) {
  return apiFetch<{ success: boolean; data: import("@/types").Flow }>("/api/campaigns/flows", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Copies a flow under the first free "X (copy)", "X (copy 2)"… name, so it never fails on a name clash. */
export function apiDuplicateFlow(id: number) {
  return apiFetch<{ success: boolean; data: import("@/types").Flow }>(`/api/campaigns/flows/${id}/duplicate`, {
    method: "POST",
  });
}

export function apiUpdateFlow(id: number, data: FlowWrite) {
  return apiFetch<{ success: boolean; data: import("@/types").Flow }>(`/api/campaigns/flows/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiDeleteFlow(id: number) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/flows/${id}`, { method: "DELETE" });
}

export function apiGetFlowRuns(id: number, params: { page?: number; limit?: number; status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  return apiFetch<{
    success: boolean;
    data: import("@/types").FlowRun[];
    variables: string[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }>(`/api/campaigns/flows/${id}/runs${qs.size ? `?${qs}` : ""}`);
}

export function apiSetCampaignFlow(campaignId: number, flowId: number | null) {
  return apiFetch<import("@/types").CampaignResponse>(`/api/campaigns/${campaignId}/flow`, {
    method: "PUT",
    body: JSON.stringify({ flowId }),
  });
}

export function apiUpdateCampaign(
  id: number,
  data: Partial<{ name: string; templateId: number; recipientIds: number[]; audienceLists: number[]; segmentId: number | null; scheduledAt: string | null; category: import("@/types").CampaignCategory; flowId: number | null }>
) {
  return apiFetch<import("@/types").CampaignResponse>(`/api/campaigns/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiDeleteCampaign(id: number) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/${id}`, { method: "DELETE" });
}

export function apiBulkDeleteCampaigns(ids: number[]) {
  return apiFetch<{ success: boolean; deletedCount: number; skippedCount: number; message: string }>(
    "/api/campaigns/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) }
  );
}

// confirmOverLimit: send even though the campaign needs more people than the
// number's Meta daily limit has left (the first try answers 409
// OVER_MESSAGING_LIMIT with the numbers in `details`).
export function apiSendCampaignNow(id: number, opts: { confirmOverLimit?: boolean } = {}) {
  return apiFetch<{ success: boolean; message?: string }>(`/api/campaigns/${id}/send`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

// ── Approval: marketing submits, an admin approves or rejects ──
export function apiSubmitCampaign(id: number) {
  return apiFetch<import("@/types").CampaignResponse>(`/api/campaigns/${id}/submit`, { method: "POST" });
}

export function apiApproveCampaign(id: number, opts: { confirmOverLimit?: boolean } = {}) {
  return apiFetch<{ success: boolean; message?: string }>(`/api/campaigns/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function apiRejectCampaign(id: number, reason: string) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// Across all numbers, for the sidebar badge. Admins only (campaign:send).
export function apiGetPendingApprovals() {
  return apiFetch<{ success: boolean; data: import("@/types").PendingApproval[]; total: number }>(
    "/api/campaigns/pending-approval",
    {},
    { numberScoped: false },
  );
}

export function apiGetCampaignCapacity(id: number) {
  return apiFetch<{ success: boolean; data: import("@/types").CampaignCapacity }>(`/api/campaigns/${id}/capacity`);
}

// Sends one template to one number for a pre-flight check. Creates no
// campaign, no recipient rows and no stored message.
/** Staff test numbers a test send may go to (Settings → Campaign safety). E.164 digits, no "+". */
export function apiGetTestPhones() {
  return apiFetch<{ success: boolean; data: string[] }>("/api/campaigns/test-phones");
}

export function apiTestSendTemplate(templateId: number, phone: string) {
  return apiFetch<{
    success: boolean;
    data: {
      to: string;
      whatsappMessageId: string;
      personalizedFor: string | null;
      asMetaTemplate: boolean;
      preview: string;
    };
  }>("/api/campaigns/test-send", {
    method: "POST",
    body: JSON.stringify({ templateId, phone }),
  });
}

export function apiCancelCampaign(id: number) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/${id}/cancel`, { method: "POST" });
}

export function apiPauseCampaign(id: number) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/${id}/pause`, { method: "POST" });
}

export function apiResumeCampaign(id: number) {
  return apiFetch<{ success: boolean }>(`/api/campaigns/${id}/resume`, { method: "POST" });
}

// ── Settings (admin only) ──
export function apiGetSettings() {
  return apiFetch<{ success: boolean; data: import("@/types").WorkspaceSettings }>("/api/settings", {}, { numberScoped: false });
}

export function apiSaveQuietHours(value: Omit<import("@/types").QuietHoursSetting, "source">) {
  return apiFetch<{ success: boolean; data: import("@/types").QuietHoursSetting }>(
    "/api/settings/quietHours",
    { method: "PUT", body: JSON.stringify(value) },
    { numberScoped: false },
  );
}

export function apiSaveCampaignSafety(value: import("@/types").CampaignSafetySetting) {
  return apiFetch<{ success: boolean; data: import("@/types").CampaignSafetySetting }>(
    "/api/settings/campaignSafety",
    { method: "PUT", body: JSON.stringify(value) },
    { numberScoped: false },
  );
}

export function apiSaveTestPhones(value: import("@/types").TestPhonesSetting) {
  return apiFetch<{ success: boolean; data: import("@/types").TestPhonesSetting }>(
    "/api/settings/testPhones",
    { method: "PUT", body: JSON.stringify(value) },
    { numberScoped: false },
  );
}

export function apiGetAdminNumbers() {
  return apiFetch<{ success: boolean; data: import("@/types").AdminWhatsAppNumber[]; tokenKeys: string[] }>(
    "/api/settings/numbers",
    {},
    { numberScoped: false },
  );
}

export function apiCreateNumber(data: { label: string; phoneNumberId: string; wabaId: string; tokenEnvKey: string; sendConcurrency?: number }) {
  return apiFetch<{ success: boolean; data: import("@/types").AdminWhatsAppNumber }>(
    "/api/settings/numbers",
    { method: "POST", body: JSON.stringify(data) },
    { numberScoped: false },
  );
}

export function apiUpdateNumber(
  id: number,
  data: Partial<{ label: string; isActive: boolean; isDefault: boolean; sendConcurrency: number; tokenEnvKey: string }>,
) {
  return apiFetch<{ success: boolean; data: import("@/types").AdminWhatsAppNumber }>(
    `/api/settings/numbers/${id}`,
    { method: "PUT", body: JSON.stringify(data) },
    { numberScoped: false },
  );
}

export function apiCheckNumberQuality() {
  return apiFetch<{
    success: boolean;
    data: { numberId: number; qualityRating?: string | null; metaStatus?: string | null; held?: boolean; campaignsPaused?: number; error?: boolean }[];
  }>("/api/settings/numbers/check-quality", { method: "POST" }, { numberScoped: false });
}

export function apiUpdateMyProfile(name: string) {
  return apiFetch<{ success: boolean; data: { id: number; name: string | null; username: string } }>(
    "/api/users/me",
    { method: "PUT", body: JSON.stringify({ name }) },
    { numberScoped: false },
  );
}

// ── Chat outcome and notes (agents and supervisors) ──
export function apiSetConversationOutcome(
  conversationId: number,
  body:
    | { outcome: "FOLLOW_UP"; followUpAt: string }
    | { outcome: null }, // cancels the follow-up
) {
  return apiFetch<{ success: boolean; data: import("@/types").ConversationOutcomeState }>(
    `/api/conversations/${conversationId}/outcome`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export function apiGetConversationNotes(conversationId: number) {
  return apiFetch<{ success: boolean; data: import("@/types").ConversationNote[] }>(`/api/conversations/${conversationId}/notes`);
}

export function apiAddConversationNote(conversationId: number, body: string) {
  return apiFetch<{ success: boolean; data: import("@/types").ConversationNote }>(
    `/api/conversations/${conversationId}/notes`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}

export function apiDeleteConversationNote(conversationId: number, noteId: number) {
  return apiFetch<{ success: boolean }>(`/api/conversations/${conversationId}/notes/${noteId}`, { method: "DELETE" });
}

// ── Supervision (team:supervise). Across all numbers; numberId narrows. ──
export function apiGetSupervisionOverview(numberId?: number) {
  const q = numberId ? `?numberId=${numberId}` : "";
  return apiFetch<{ success: boolean; data: import("@/types").SupervisionOverview }>(
    `/api/supervision/overview${q}`, {}, { numberScoped: false },
  );
}

export function apiGetSupervisionConversations(params: {
  filter?: import("@/types").SupervisionFilter;
  agentId?: number | "unassigned";
  numberId?: number;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return apiFetch<{
    success: boolean;
    data: import("@/types").SupervisionConversation[];
    slaMinutes: number;
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }>(`/api/supervision/conversations?${q}`, {}, { numberScoped: false });
}

export function apiGetSupervisionTimeline(conversationId: number) {
  return apiFetch<{ success: boolean; data: import("@/types").SupervisionTimeline }>(
    `/api/supervision/conversations/${conversationId}`, {}, { numberScoped: false },
  );
}

// The live feed. after = only what happened since (poll with the newest `at`).
export function apiGetSupervisionActivity(params: { after?: string; limit?: number; numberId?: number } = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return apiFetch<{ success: boolean; data: import("@/types").SupervisionActivity[]; serverTime: string }>(
    `/api/supervision/activity?${q}`, {}, { numberScoped: false },
  );
}

// The supervisor's report for a period (from/to YYYY-MM-DD, both days
// included, max 92 days; clinic time zone). numberId narrows to one line.
export function apiGetSupervisionReport(params: { from: string; to: string; numberId?: number }) {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.numberId) q.set("numberId", String(params.numberId));
  return apiFetch<{ success: boolean; data: import("@/types").SupervisionReport }>(`/api/supervision/report?${q}`, {}, { numberScoped: false });
}

// Messages of the chosen chats within the period (max 100 chats, 300 messages each).
export function apiGetReportTranscripts(params: { ids: number[]; from: string; to: string }) {
  const q = new URLSearchParams({ ids: params.ids.join(","), from: params.from, to: params.to });
  return apiFetch<{ success: boolean; data: import("@/types").ReportTranscript[] }>(`/api/supervision/report/transcripts?${q}`, {}, { numberScoped: false });
}

// ── Detailed supervisor reports (same period rules as the overview report) ──

export type ReportQuery = { from: string; to: string; numberId?: number };

function reportQuery(params: ReportQuery): URLSearchParams {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.numberId) q.set("numberId", String(params.numberId));
  return q;
}

/** Team and per-person speed, volume and results, day by day and hour by hour. */
export function apiGetTeamReport(params: ReportQuery) {
  return apiFetch<{ success: boolean; data: import("@/types").TeamReport }>(`/api/supervision/reports/team?${reportQuery(params)}`, {}, { numberScoped: false });
}

/** Campaigns started in the period, from sent to replied. */
export function apiGetCampaignsReport(params: ReportQuery) {
  return apiFetch<{ success: boolean; data: import("@/types").CampaignsReport }>(`/api/supervision/reports/campaigns?${reportQuery(params)}`, {}, { numberScoped: false });
}

/** The Marketing dashboard: campaign funnel, flows, audience, line health, what needs attention. */
export function apiGetMarketingStats(params: ReportQuery) {
  return apiFetch<{ success: boolean; data: import("@/types").MarketingStats }>(`/api/stats/marketing?${reportQuery(params)}`, {}, { numberScoped: false });
}

/** One row per chat with a message in the period (up to 5000). */
export function apiGetChatsReport(params: ReportQuery) {
  return apiFetch<{ success: boolean; data: import("@/types").ChatsReport }>(`/api/supervision/reports/chats?${reportQuery(params)}`, {}, { numberScoped: false });
}

// ── Opt-out from a chat: any agent records one; only an admin (optout:lift) lifts one ──
// scope "line" = no campaigns from this WhatsApp line; "all" = do not contact on any line.
export function apiOptOutPatient(conversationId: number, scope: "line" | "all", reason?: string) {
  return apiFetch<{ success: boolean; data: { line: { optedOutAt: string; source: string } | null; all: boolean } }>(
    `/api/conversations/${conversationId}/opt-out`,
    { method: "POST", body: JSON.stringify({ scope, reason }) },
  );
}

export function apiLiftOptOut(conversationId: number, scope: "line" | "all") {
  return apiFetch<{ success: boolean; data: { line: { optedOutAt: string; source: string } | null; all: boolean } }>(
    `/api/conversations/${conversationId}/opt-out?scope=${scope}`,
    { method: "DELETE" },
  );
}

// Unread chats / waiting (last 24h) on every active line.
export function apiGetLineCounts() {
  return apiFetch<{ success: boolean; data: { id: number; label: string; unreadChats: number; waiting: number }[] }>(
    "/api/conversations/line-counts", {}, { numberScoped: false },
  );
}

// Server rules: newPassword ≥ 8 characters; 401 if currentPassword is wrong.
export function apiChangeMyPassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ success: boolean; message?: string }>(
    "/api/users/me/password",
    { method: "PUT", body: JSON.stringify({ currentPassword, newPassword }) },
    { numberScoped: false },
  );
}

// WhatsApp number health
export function apiGetWhatsAppStatus() {
  return apiFetch<import("@/types").WhatsAppPhoneStatusResponse>("/api/whatsapp/status");
}

export function apiGetWhatsAppNumbers() {
  return apiFetch<import("@/types").WhatsAppNumbersListResponse>("/api/whatsapp/numbers");
}

// The switcher's list: from this app's own database, not a live Graph call, so
// it renders instantly and still works when Meta is slow.
export function apiGetMyWhatsAppNumbers() {
  return apiFetch<import("@/types").ConfiguredNumbersResponse>("/api/whatsapp/my-numbers");
}

// Media has to bypass the JSON path above (apiFetch always calls res.json()),
// but it must NOT bypass the header and abort handling — a media id is only
// readable with a token that can reach its own number. Built on the same
// request setup so there is still exactly one place headers are assembled.
export async function apiFetchMediaBlob(messageId: string | number): Promise<Blob> {
  const headers: Record<string, string> = {
    ...CSRF_HEADER,
    ...(activeNumberId ? { "X-WhatsApp-Number-Id": activeNumberId } : {}),
  };
  const epochAtStart = numberEpoch;

  const res = await fetch(`${BASE}/api/messages/${messageId}/media`, {
    headers,
    signal: numberAbort.signal,
    credentials: "include",
  });

  if (epochAtStart !== numberEpoch) return neverSettles<Blob>();
  if (!res.ok) throw new ApiError(`Media unavailable (HTTP ${res.status})`, res.status);
  return res.blob();
}

export function apiCreateConversation(customerId: number) {
  return apiFetch<{ success: boolean; data: import("@/types").Conversation; created: boolean }>(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ customerId }) }
  );
}

export function apiSendTemplate(
  conversationId: string,
  templateId: number,
  // confirmOptedOut: send a marketing template to a patient who opted out —
  // the first try answers 409 OPTED_OUT (details.scope "line" | "all").
  opts: { clientMessageId?: string; confirmOtherOwner?: boolean; confirmOptedOut?: boolean } = {},
) {
  return apiFetch<{ success: boolean; data: import("@/types").Message }>(
    `/api/templates/conversations/${conversationId}/send-template`,
    { method: "POST", body: JSON.stringify({ templateId, ...opts }) }
  );
}

// Lists
export function apiGetLists() {
  return apiFetch<ContactListListResponse>("/api/lists");
}

export function apiCreateList(data: { name: string; description?: string }) {
  return apiFetch<ContactListResponse>("/api/lists", { method: "POST", body: JSON.stringify(data) });
}

export function apiGetList(id: string | number, page = 1, limit = 30, search = "") {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.append("search", search);
  return apiFetch<ContactListDetailResponse>(`/api/lists/${id}?${params.toString()}`);
}

export function apiUpdateList(id: string | number, data: Partial<{ name: string; description: string }>) {
  return apiFetch<ContactListResponse>(`/api/lists/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function apiDeleteList(id: string | number) {
  return apiFetch<{ success: boolean; message: string }>(`/api/lists/${id}`, { method: "DELETE" });
}

export function apiAddListMembers(id: string | number, customerIds: number[]) {
  return apiFetch<{ success: boolean; message: string; data: { added: number; alreadyInList: number } }>(
    `/api/lists/${id}/members`,
    { method: "POST", body: JSON.stringify({ customerIds }) }
  );
}

export function apiRemoveListMember(id: string | number, customerId: number) {
  return apiFetch<{ success: boolean; message: string }>(`/api/lists/${id}/members/${customerId}`, { method: "DELETE" });
}

export function apiGetListMemberIds(id: string | number) {
  return apiFetch<{ success: boolean; data: { listId: number; name: string; customerIds: number[] } }>(
    `/api/lists/${id}/members/ids`
  );
}

export function apiValidateListImport(id: string | number, file: File, dateFormat = "auto", defaultCountry = "") {
  const form = new FormData();
  form.append("file", file);
  form.append("dateFormat", dateFormat);
  form.append("defaultCountry", defaultCountry);
  return apiFetch<{
    success: boolean;
    data: { total: number; valid: number; duplicates: ImportIssue[]; invalid: ImportIssue[] };
  }>(`/api/lists/${id}/import/validate`, { method: "POST", body: form });
}

export function apiImportListMembers(id: string | number, file: File, dateFormat = "auto", defaultCountry = "") {
  const form = new FormData();
  form.append("file", file);
  form.append("dateFormat", dateFormat);
  form.append("defaultCountry", defaultCountry);
  return apiFetch<{
    success: boolean;
    data: {
      total: number;
      created: number;
      matchedExisting: number;
      linked: number;
      alreadyInList: number;
      duplicatesInFile: number;
      errors: ImportIssue[];
    };
  }>(`/api/lists/${id}/import`, { method: "POST", body: form });
}

// ── Segments ────────────────────────────────────────────────────────────────

/**
 * Both the customers screen and the segment builder speak the same rule
 * grammar, so the definition travels as one JSON-encoded `filter` param
 * rather than being flattened into a dozen query keys. A definition with no
 * rules is omitted entirely — sending `{rules:[]}` would read as "match
 * everyone", which is right, but sending nothing is cheaper and clearer.
 */
function filterParam(definition?: import("@/types").SegmentDefinition | null): string | null {
  if (!definition || !definition.rules?.length) return null;
  return JSON.stringify(definition);
}

export function apiGetSegments() {
  return apiFetch<import("@/types").SegmentListResponse>("/api/segments");
}

export function apiGetSegment(id: number | string) {
  return apiFetch<import("@/types").SegmentResponse>(`/api/segments/${id}`);
}

export function apiCreateSegment(data: {
  name: string;
  description?: string;
  definition: import("@/types").SegmentDefinition;
  excludeOptedOut?: boolean;
}) {
  return apiFetch<import("@/types").SegmentResponse>("/api/segments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function apiUpdateSegment(
  id: number | string,
  data: Partial<{
    name: string;
    description: string;
    definition: import("@/types").SegmentDefinition;
    excludeOptedOut: boolean;
  }>
) {
  return apiFetch<import("@/types").SegmentResponse>(`/api/segments/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function apiDeleteSegment(id: number | string) {
  return apiFetch<{ success: boolean; message: string }>(`/api/segments/${id}`, { method: "DELETE" });
}

/**
 * Count an unsaved rule. This is the call that makes the builder honest — it
 * runs the same compiler the send path runs, so the number shown here is the
 * number that gets messaged.
 */
export function apiPreviewSegment(
  definition: import("@/types").SegmentDefinition,
  excludeOptedOut = true
) {
  return apiFetch<import("@/types").SegmentPreviewResponse>("/api/segments/preview", {
    method: "POST",
    body: JSON.stringify({ definition, excludeOptedOut }),
  });
}

export function apiGetSegmentFields() {
  return apiFetch<import("@/types").SegmentFieldsResponse>("/api/segments/fields");
}

export function apiGetSegmentOptions() {
  return apiFetch<import("@/types").SegmentOptionsResponse>("/api/segments/options");
}

export function apiGetSegmentMemberIds(id: number | string) {
  return apiFetch<import("@/types").SegmentMemberIdsResponse>(`/api/segments/${id}/members/ids`);
}

export function apiGetSegmentMembers(id: number | string, page = 1, limit = 30, search = "") {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.append("search", search);
  return apiFetch<import("@/types").CustomerListResponse & { data: import("@/types").Customer[] }>(
    `/api/segments/${id}/members?${params.toString()}`
  );
}

/** Filtered customer page — same signature as apiGetCustomers plus a rule. */
export function apiGetCustomersFiltered(
  page = 1,
  limit = 20,
  search = "",
  definition?: import("@/types").SegmentDefinition | null
) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.append("search", search);
  const filter = filterParam(definition);
  if (filter) params.append("filter", filter);
  return apiFetch<CustomerListResponse>(`/api/customers?${params.toString()}`);
}

/**
 * Every id matching the current filter, not just the visible page. "Select all
 * 1,284 matches" has to mean all of them, and only the server knows the rest.
 */
export function apiGetFilteredCustomerIds(
  search = "",
  definition?: import("@/types").SegmentDefinition | null
) {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  const filter = filterParam(definition);
  if (filter) params.append("filter", filter);
  const qs = params.toString();
  return apiFetch<import("@/types").CustomerIdsResponse>(`/api/customers/ids${qs ? `?${qs}` : ""}`);
}

/** Re-run a DRAFT campaign's segment against current data. DRAFT-only server-side. */
export function apiRefreshCampaignAudience(id: number) {
  return apiFetch<
    import("@/types").CampaignResponse & {
      meta: { previousCount: number; newCount: number; delta: number };
    }
  >(`/api/campaigns/${id}/refresh-audience`, { method: "POST" });
}
