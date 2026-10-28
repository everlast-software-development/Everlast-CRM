export interface User {
  id: string;
  username: string;
  role: string;
  // Returned by POST /api/auth/login, so the first screen after login can be
  // chosen by what the user may actually do. Gate on this, never on `role`.
  permissions?: import("@/lib/permissions").Permission[];
}

export type Gender = "MALE" | "FEMALE";

export interface Customer {
  _id?: string;
  id?: number;
  chartNumber: string | null;
  name: string | null;
  phone: string;
  email: string | null;
  nationality: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  joinDate: string | null;
  departments: string[]; // ordered by rank: index 0 = top department
  tags: string[];
  notes: string | null;
  optedOut?: boolean;
  createdAt: string;
}

export interface Conversation {
  _id?: string;
  id?: string | number;
  customerId?: string | number;
  customer?: Customer;
  assignedAgentId: number | null;
  assignedAgent: { id: number; name?: string | null; username: string } | null;
  status: "OPEN" | "PENDING" | "RESOLVED";
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderType: "CUSTOMER" | "AGENT" | "BOT" | null;
  lastCustomerMessageAt?: string | null;
}

export interface QuotedMessage {
  id: number;
  content: string;
  messageType: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "STICKER";
  senderType: "CUSTOMER" | "AGENT" | "BOT";
  mediaUrl?: string | null;
  deletedAt?: string | null;
}

export interface Message {
  _id?: string;
  id?: string | number;
  conversationId: string;
  senderType: "CUSTOMER" | "AGENT" | "BOT";
  senderId: string | null;
  content: string;
  messageType: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "STICKER";
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  whatsappMessageId?: string | null;
  mediaUrl?: string | null;
  reactions?: Record<string, number> | null;
  quotedMessageId?: number | null;
  quotedMessage?: QuotedMessage | null;
  /** Set on an inbound message that answers a campaign — drives the "Reply to" tag. */
  campaignRecipientId?: number | null;
  campaignRecipient?: { campaign: { id: number; name: string } } | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: number;
  action: string;
  actorId: number | null;
  actorUsername: string | null;
  targetType: string;
  targetId: number;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface LoginResponse {
  success: boolean;
  user: User;
}

export interface ConversationListResponse {
  success: boolean;
  data: Conversation[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MessagesResponse {
  success: boolean;
  data: Message[];
}

export interface SendMessageResponse {
  success: boolean;
  data: {
    _id?: string;
    id: number;
    senderType: string;
    content: string;
    status: "SENT" | "FAILED";
    whatsappMessageId: string;
  };
}

export interface CustomerListResponse {
  success: boolean;
  data: Customer[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CustomerResponse {
  success: boolean;
  data: Customer;
}

export interface ContactList {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListListResponse {
  success: boolean;
  data: ContactList[];
}

export interface ContactListResponse {
  success: boolean;
  data: ContactList;
}

export interface ContactListDetailResponse {
  success: boolean;
  data: ContactList & { members: (Customer & { addedAt: string })[] };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AuditLogResponse {
  success: boolean;
  data: AuditLog[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ─── Error log (GET /api/audit/errors) ─────────────────────────────────────
export type ErrorSource = "webhook" | "delivery" | "send" | "flow" | "campaign" | "api" | "job" | "templates" | "number" | "system";

export interface ErrorLogEntry {
  id: number;
  source: ErrorSource;
  code: string | null;
  message: string;
  /** How many times it happened while open (repeats are grouped). */
  count: number;
  details: Record<string, unknown> | null;
  conversationId: number | null;
  campaignId: number | null;
  flowRunId: number | null;
  whatsappNumberId: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface ErrorLogResponse {
  success: boolean;
  data: ErrorLogEntry[];
  /** Open entries per source, for the filter chips. */
  openBySource: Partial<Record<ErrorSource, number>>;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export type UserStatus = "ONLINE" | "OFFLINE" | "ON_BREAK";

export interface StatsOverview {
  messages: { today: number; last7Days: number };
  conversations: { open: number; pending: number; resolved: number; unassigned: number; total: number };
  customers: { total: number; newLast7Days: number };
  /** Staff presence — null without stats:team (marketing never gets it). */
  agents: { online: number; onBreak: number; offline: number } | null;
  unreadMessages: number;
  // Conversations with at least one unread message (the Inbox badge).
  unreadConversations: number;
}

export interface MessageChartDay {
  date: string;
  incoming: number;
  outgoing: number;
}

export interface AgentStat {
  id: string;
  name: string | null;
  username: string;
  status: string;
  lastActiveAt: string | null;
  assignedConversations: number;
  openConversations: number;
  messagesSentLast7Days: number;
  avgResponseTimeMinutes: number | null;
}

export interface StatsOverviewResponse {
  success: boolean;
  data: StatsOverview;
}

export interface StatsMessagesResponse {
  success: boolean;
  data: {
    chart: MessageChartDay[];
    typeBreakdown: Record<string, number>;
    statusBreakdown: Record<string, number>;
    peakHour: number | null;
  };
}

export interface StatsAgentsResponse {
  success: boolean;
  data: {
    agents: AgentStat[];
    statusSummary: { ONLINE: number; ON_BREAK: number; OFFLINE: number };
  };
}

// PAUSED / DISABLED: Meta stopped an approved template (quality, blocks).
export type TemplateStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
// What a template imported from Meta still lacks before it can be sent:
// "variables" = {{1}}-style placeholders nobody has said the meaning of;
// "media" = only Meta's (expiring) sample file for the header or cards.
export type TemplateSetupNeed = "variables" | "media";
export type TemplateCategory = "GENERAL" | "RE_ENGAGEMENT" | "CAMPAIGN";
export type TemplateHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";

export interface TemplateButton {
  id: string;
  type: TemplateButtonType;
  title: string;
  url?: string;
  phoneNumber?: string;
  // COPY_CODE: the offer code the patient copies (≤15 letters or digits).
  code?: string;
}

export interface Template {
  id: number;
  name: string;
  metaTemplateName: string | null;
  metaTemplateId: string | null;
  category: TemplateCategory;
  approvalStatus: TemplateStatus;
  rejectionReason: string | null;
  // When Meta last approved/rejected it (null until it decides).
  statusChangedAt?: string | null;
  language: string;
  headerType: TemplateHeaderType;
  header: string | null;
  headerMediaUrl: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[] | null;
  // Present = a carousel template (2–10 cards); header/footer/buttons unused.
  cards?: TemplateCard[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Computed by GET /api/templates; non-empty = can't be sent yet.
  needsSetup?: TemplateSetupNeed[];
}

export interface TemplateImportResult {
  success: boolean;
  dryRun: boolean;
  // id is null on a dry run.
  imported: { id: number | null; name: string; metaTemplateName: string; language: string; status: TemplateStatus; needsSetup: TemplateSetupNeed[] }[];
  // Templates already in the CRM whose Meta status was refreshed.
  updated: number;
  skipped: { name: string; language: string; reason: string }[];
  // Meta had more than the 1,000 templates one import reads.
  truncated: boolean;
}

export interface TemplateCardButton {
  id: string; // positional: b0, b1
  type: "QUICK_REPLY" | "URL";
  title: string;
  url?: string;
}

export interface TemplateCard {
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  body: string;
  buttons: TemplateCardButton[];
}

export interface TemplateListResponse {
  success: boolean;
  data: Template[];
}

export interface TemplateResponse {
  success: boolean;
  data: Template;
}

export type MediaAssetType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

export interface MediaAsset {
  id: number;
  url: string;
  publicId: string;
  mediaType: MediaAssetType;
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  filename: string | null;
  createdAt: string;
  usageCount: number;
}

export interface MediaAssetListResponse {
  success: boolean;
  data: MediaAsset[];
}

export interface MediaAssetResponse {
  success: boolean;
  data: MediaAsset;
}

export type UserRole = "ADMIN" | "MARKETING" | "AGENT" | "SUPERVISOR" | "DIRECTOR";

export interface AgentUser {
  id: number;
  name: string | null;
  username: string;
  role: UserRole;
  /**
   * Capabilities this user holds, served by GET /api/users/me straight from the
   * server's permission map. Gate UI on this rather than on `role` — the role
   * list grows, and a check against one name silently excludes the others.
   * Optional because list endpoints return other users without it; only /me
   * carries it.
   */
  permissions?: import("@/lib/permissions").Permission[];
  status: UserStatus;
  /**
   * False once deactivated (can't sign in; history stays credited to them).
   * Optional: only shown when the server includes it in the user list.
   */
  isActive?: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number; assignedConversations: number };
}

export interface UserListResponse {
  success: boolean;
  data: AgentUser[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface UserResponse {
  success: boolean;
  data: AgentUser;
}

export type CampaignStatus = "DRAFT" | "PENDING_APPROVAL" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type CampaignCategory = "PROMOTION" | "SEASONAL" | "EVENT" | "AWARENESS" | "FOLLOW_UP" | "ANNOUNCEMENT" | "OTHER";
export type CampaignPauseReason =
  | "MANUAL"
  | "QUIET_HOURS"
  | "NUMBER_INACTIVE"
  | "SEND_ERROR"
  // Meta's throughput limit / no answer from Meta: resumed automatically at resumeAt.
  | "RATE_LIMIT"
  | "CONNECTION"
  // Template deleted, or paused/disabled by Meta. Needs a person.
  | "TEMPLATE_UNAVAILABLE"
  // The number's Meta quality rating dropped (Settings → Campaign safety).
  | "QUALITY";
export type CampaignRecipientStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";

export interface Campaign {
  id: number;
  name: string;
  templateId: number;
  template?: Pick<Template, "id" | "name" | "category" | "body" | "header" | "footer" | "buttons">;
  category: CampaignCategory;
  status: CampaignStatus;
  pauseReason?: CampaignPauseReason | null;
  // Why it paused, e.g. Meta's error for SEND_ERROR.
  pauseDetail?: string | null;
  // When an automatic pause (RATE_LIMIT / CONNECTION) resumes by itself.
  resumeAt?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  sentCount: number;
  failedCount: number;
  // Opted out, or over the per-patient campaign limit, when their turn came.
  skippedCount?: number;
  totalRecipients: number;
  deliveredCount?: number;
  readCount?: number;
  repliedCount?: number;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  // Approval trail: marketing submits, an admin approves (sends / schedules)
  // or rejects with a reason (back to DRAFT, reason kept until resubmitted).
  submittedById?: number | null;
  submittedBy?: { id: number; name: string | null; username: string } | null;
  submittedAt?: string | null;
  reviewedById?: number | null;
  reviewedBy?: { id: number; name: string | null; username: string } | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  recipients?: CampaignRecipient[];
  // The automation answering this campaign's template buttons.
  flowId?: number | null;
  flow?: { id: number; name: string; isActive: boolean } | null;
}

export interface CampaignRecipient {
  id: number;
  campaignId: number;
  customerId: number;
  customer?: Pick<Customer, "id" | "name" | "phone" | "tags">;
  status: CampaignRecipientStatus;
  messageId?: number | null;
  error?: string | null;
  sentAt?: string | null;
}

export interface CampaignListResponse {
  success: boolean;
  data: Campaign[];
}

export interface CampaignResponse {
  success: boolean;
  data: Campaign;
}

export type WhatsAppQualityRating = "GREEN" | "YELLOW" | "RED" | "NA" | "UNKNOWN";
export type WhatsAppPhoneNumberStatus = "CONNECTED" | "FLAGGED" | "RESTRICTED" | "BANNED" | "UNKNOWN" | string;

export interface WhatsAppPhoneStatus {
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: WhatsAppQualityRating;
  status: WhatsAppPhoneNumberStatus;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  throughputLevel: string | null;
  messagingLimitTier: string | null;
  fetchedAt: string;
}

export interface WhatsAppPhoneStatusResponse {
  success: boolean;
  data: WhatsAppPhoneStatus;
}

export interface WhatsAppPhoneNumberSummary {
  id: string;
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: WhatsAppQualityRating;
  status: WhatsAppPhoneNumberStatus;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  throughputLevel: string | null;
  isPrimary: boolean;
}

export interface WhatsAppNumbersListResponse {
  success: boolean;
  data: WhatsAppPhoneNumberSummary[];
  fetchedAt: string;
}

// ── Segments ────────────────────────────────────────────────────────────────
// A saved audience RULE. Unlike a ContactList — whose membership is frozen the
// moment it is built — a segment is re-evaluated every time it is used, so it
// always describes who qualifies *now*.
//
// The rule grammar is owned by the server (utils/segmentFilter.js) and served
// by GET /api/segments/fields, so the builder never hardcodes it.

export type SegmentMatch = "ALL" | "ANY";

export type SegmentField =
  | "name" | "phone" | "email" | "chartNumber"
  | "nationality" | "gender" | "department" | "tag"
  | "joinDate" | "createdAt" | "age" | "birthdayMonth"
  | "optedOut" | "hasConversation" | "lastInboundAt" | "lastCampaignAt" | "list";

export type SegmentOp =
  | "eq" | "in" | "not_in" | "contains" | "starts_with" | "exists"
  | "has_any" | "has_all" | "has_none" | "is_empty"
  | "before" | "after" | "between"
  | "gte" | "lte"
  | "in_last_days" | "older_than_days" | "never";

export type SegmentRuleValue = string | number | boolean | (string | number)[];

export interface SegmentRule {
  field: SegmentField;
  op: SegmentOp;
  value: SegmentRuleValue;
}

export interface SegmentDefinition {
  match: SegmentMatch;
  rules: SegmentRule[];
}

export interface Segment {
  id: number;
  name: string;
  description: string | null;
  definition: SegmentDefinition;
  excludeOptedOut: boolean;
  createdById: number | null;
  createdBy?: { id: number; name: string | null; username: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Live count, recomputed per request — null when the rule no longer compiles. */
  reachable?: number | null;
  matched?: number;
  suppressed?: number;
  sample?: SegmentSampleContact[];
  campaignCount?: number;
  error?: string | null;
}

/** The trimmed contact shape a preview returns — enough to eyeball, not a full record. */
export interface SegmentSampleContact {
  id: number;
  name: string | null;
  phone: string;
  gender: Gender | null;
  nationality: string | null;
  departments: string[];
  tags: string[];
  joinDate: string | null;
  optedOut: boolean;
}

export interface SegmentPreview {
  /** Contacts matching the rules alone. */
  matched: number;
  /** Contacts actually messageable — matched minus opt-outs. */
  reachable: number;
  suppressed: number;
  excludeOptedOut: boolean;
  sample: SegmentSampleContact[];
  ruleCount: number;
}

/** Field catalogue from the server, so operator menus stay in sync with the compiler. */
export interface SegmentFieldSpec {
  field: SegmentField;
  label: string;
  ops: SegmentOp[];
}

/** Real distinct values behind the free-text columns, so users pick instead of typing. */
export interface SegmentOptions {
  departments: string[];
  tags: string[];
  nationalities: string[];
  lists: { id: number; name: string; memberCount: number }[];
}

export interface SegmentListResponse {
  success: boolean;
  data: Segment[];
}
export interface SegmentResponse {
  success: boolean;
  data: Segment;
}
export interface SegmentPreviewResponse {
  success: boolean;
  data: SegmentPreview;
}
export interface SegmentFieldsResponse {
  success: boolean;
  data: SegmentFieldSpec[];
}
export interface SegmentOptionsResponse {
  success: boolean;
  data: SegmentOptions;
}
export interface SegmentMemberIdsResponse {
  success: boolean;
  data: { id: number; name: string; customerIds: number[]; count: number };
}
export interface CustomerIdsResponse {
  success: boolean;
  data: { customerIds: number[]; count: number };
}

// A WhatsApp number as this app has it configured, from /api/whatsapp/my-numbers.
// Distinct from WhatsAppPhoneNumberSummary, which is what Meta reports live:
// `id` here is this app's internal row id (what X-WhatsApp-Number-Id carries),
// NOT Meta's phone_number_id. Conflating the two is a nasty class of bug.
export interface ConfiguredWhatsAppNumber {
  id: number;
  label: string;
  phoneNumberId: string;
  wabaId: string;
  // The WhatsApp account's name as it appears in WhatsApp Manager, fetched from
  // Meta. Null when Meta couldn't be reached — fall back to a label built from
  // wabaId rather than rendering nothing.
  accountName: string | null;
  displayPhoneNumber: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface ConfiguredNumbersResponse {
  success: boolean;
  data: ConfiguredWhatsAppNumber[];
  activeNumberId: number | null;
}

// ── Inbox workflow ────────────────────────────────────────────────────────────

/** The inbox's server-side work queues. See getAllConversations on the API. */
export type ConversationView = "all" | "mine" | "unassigned" | "campaign_replies" | "follow_ups";

export interface ConversationCounts {
  mine: number;
  unassigned: number;
  campaign_replies: number;
  /** My follow-ups: chats I own, or unassigned ones I set to Follow up. */
  follow_ups: number;
  /** Of those, the ones due now or overdue. */
  follow_ups_due: number;
}

/** Socket "follow_up.due": sent to the agent responsible, on every line. */
export interface FollowUpDueEvent {
  conversationId: number;
  whatsappNumberId: number;
  followUpAt: string;
  customerName: string | null;
  customerPhone: string;
}

/**
 * What a hand-over moved (end of shift, a supervisor covering an absence, or
 * an account deactivated / losing inbox access). `to` null = back to the queue.
 */
export interface HandOverResult {
  chats: number;
  to: { id: number; name: string | null; username: string } | null;
}

/** Someone a conversation can be given to: active, and a role that can reply. */
export interface AssignableUser {
  id: number;
  name: string | null;
  username: string;
  status: "ONLINE" | "OFFLINE" | "ON_BREAK";
}

/** One row of a campaign's Replies worklist. */
export interface CampaignReply {
  recipientId: number;
  repliedAt: string;
  customer: { id: number; name: string | null; phone: string };
  reply: { id: number; content: string; messageType: string; createdAt: string } | null;
  conversation: {
    id: number;
    status: "OPEN" | "PENDING" | "RESOLVED";
    assignedAgent: { id: number; name: string | null; username: string } | null;
  } | null;
  /** The patient spoke last and the chat isn't resolved. */
  needsResponse: boolean;
}

// ─── Flows (campaign automations) ────────────────────────────────────────────
// Mirrors everlast-nodejs-crm-api/utils/flowGraph.js, which validates on save.

export type FlowNodeType = "trigger" | "message" | "list" | "carousel" | "cards" | "question" | "slot_picker" | "tag" | "assign" | "end";
export type FlowMediaType = "NONE" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type FlowInputType = "text" | "number" | "email" | "phone" | "date";

export interface FlowOption { id: string; title: string; description?: string }

/** A card in a Cards step (or a carousel template snapshot, which has only label + buttons). */
export interface FlowCard {
  id?: string;
  label?: string;
  mediaType?: "IMAGE" | "VIDEO";
  mediaUrl?: string;
  body?: string;
  buttons: { id: string; title: string; type?: "QUICK_REPLY" | "URL"; url?: string }[];
}

export interface FlowNodeData {
  // trigger: the template its buttons were copied from
  templateId?: number | null;
  // trigger / message
  buttons?: FlowOption[];
  // message
  mediaType?: FlowMediaType;
  mediaUrl?: string;
  /** message: one "open link" button instead of reply buttons (e.g. a product page). */
  link?: { title: string; url: string };
  // message / list / question / assign / end
  text?: string;
  footer?: string;
  // list
  header?: string;
  buttonLabel?: string;
  rows?: FlowOption[];
  // question / message with buttons / list: the field the answer is saved in
  variable?: string;
  inputType?: FlowInputType;
  errorText?: string;
  // carousel: snapshot of the template's cards (label + quick replies).
  // cards: the product cards themselves (id, media, text, buttons).
  cards?: FlowCard[];
  // tag
  tag?: string;
  // assign
  agentId?: number | null;
  [key: string]: unknown;
}

export interface FlowNode { id: string; type: FlowNodeType; position: { x: number; y: number }; data: FlowNodeData }
export interface FlowEdge { id: string; source: string; sourceHandle: string; target: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }

export type FlowRunStatus = "ACTIVE" | "COMPLETED" | "HANDED_OFF" | "STOPPED" | "EXPIRED" | "FAILED";
export type FlowRunStats = { total: number } & Partial<Record<FlowRunStatus, number>>;

export interface FlowSummary {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: number; name: string | null; username: string };
  campaignCount: number;
  runs: FlowRunStats;
}

export interface Flow extends Omit<FlowSummary, "campaignCount"> {
  graph: FlowGraph;
  variables: string[];
  campaigns?: { id: number; name: string; status: CampaignStatus }[];
}

export interface FlowRun {
  id: number;
  flowId: number;
  conversationId: number;
  status: FlowRunStatus;
  currentNodeId: string | null;
  data: {
    answers?: Record<string, string>;
    // from: "earlier message" when the tap was on an older message.
    path?: { node: string; choice?: string; answer?: string; tag?: string; handedOffTo?: string; from?: string; at: string }[];
  };
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
  customer: { id: number; name: string | null; phone: string };
  campaign: { id: number; name: string } | null;
}

export interface FlowValidationError { nodeId?: string; message: string }

// ─── Contact panel (GET /api/conversations/:id/profile) ──────────────────────
export interface ConversationProfile {
  customer: Customer & { id: number };
  conversation: {
    id: number;
    status: string;
    createdAt: string;
    lastCustomerMessageAt: string | null;
    assignedAgent: { id: number; name: string | null; username: string } | null;
    messageCount: number;
  };
  optOut: { optedOutAt: string; source: string } | null;
  responses: {
    id: number;
    flow: { id: number; name: string };
    status: FlowRunStatus;
    startedAt: string;
    completedAt: string | null;
    answers: Record<string, string>;
  }[];
  media: { id: number; messageType: "IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO"; mediaUrl: string | null; content: string; senderType: string; createdAt: string }[];
  mediaCounts: Partial<Record<"IMAGE" | "VIDEO" | "DOCUMENT" | "AUDIO", number>>;
  links: { messageId: number; url: string; senderType: string; createdAt: string }[];
  campaigns: { id: number; name: string; sentAt: string | null; repliedAt: string | null }[];
}

// ── Campaign approval ─────────────────────────────────────────────────────

export interface PendingApproval {
  id: number;
  name: string;
  whatsappNumberId: number;
  whatsappNumber: { label: string };
  totalRecipients: number;
  scheduledAt: string | null;
  submittedAt: string | null;
  submittedBy: { id: number; name: string | null; username: string } | null;
  template: { id: number; name: string };
}

// Meta's daily limit on different people a number may message (the
// OVER_MESSAGING_LIMIT error's `details` has this shape too).
export interface CampaignCapacity {
  tier: string | null;
  limit: number | null;
  unlimited: boolean;
  usedLast24h: number;
  needed: number;
  remaining: number | null;
  overLimit: boolean;
}

// ── Settings (admin) ──────────────────────────────────────────────────────

export interface QuietHoursSetting {
  enabled: boolean;
  start: string; // "21:00"
  end: string; // "09:00"
  timezone: string; // "Asia/Dubai"
  // "server" until an admin saves it in Settings.
  source?: "settings" | "server";
}

export interface CampaignSafetySetting {
  // 0 = off. Otherwise one campaign per patient per number every N days.
  frequencyCapDays: number;
  // Pause campaigns and hold new ones when the number's quality drops.
  qualityAutoPause: boolean;
  qualityPauseAt: "YELLOW" | "RED";
}

// Staff phones campaign test sends may go to. E.164 digits, no "+".
export interface TestPhonesSetting {
  phones: string[];
}

export interface WorkspaceSettings {
  quietHours: QuietHoursSetting;
  campaignSafety: CampaignSafetySetting;
  testPhones: TestPhonesSetting;
}

export interface AdminWhatsAppNumber {
  id: number;
  label: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  tokenEnvKey: string;
  hasToken: boolean;
  isActive: boolean;
  isDefault: boolean;
  sendConcurrency: number;
  qualityRating: string | null;
  metaStatus: string | null;
  qualityCheckedAt: string | null;
  createdAt: string;
  activeCampaigns?: number;
}

// ── Chat outcomes and notes ───────────────────────────────────────────────

// The raw API union. Only "FOLLOW_UP" can be set now; "BOOKED" (booking was
// removed), "NOT_INTERESTED" and "NO_ANSWER" (dropped reporting labels) only
// appear on old rows, and the UI
// reads them as no outcome — see activeOutcome() in lib/chatOutcome.ts.
export type ConversationOutcome = "BOOKED" | "NOT_INTERESTED" | "FOLLOW_UP" | "NO_ANSWER";

export interface PersonRef {
  id: number;
  name: string | null;
  username: string;
}

export interface ConversationNote {
  id: number;
  conversationId: number;
  body: string;
  createdAt: string;
  author: PersonRef | null;
}

// What PUT /conversations/:id/outcome returns.
export interface ConversationOutcomeState {
  id: number;
  outcome: ConversationOutcome | null;
  outcomeAt: string | null;
  outcomeBy: PersonRef | null;
  followUpAt: string | null;
}

// ── Supervision ───────────────────────────────────────────────────────────

export interface SupervisionAgent {
  id: number;
  name: string | null;
  username: string;
  role: UserRole;
  status: "ONLINE" | "OFFLINE" | "ON_BREAK";
  lastActiveAt: string | null;
  openChats: number;
  waiting: number;
  waitingOverSla: number;
  repliesToday: number;
  // Their latest reply today (null if none yet).
  lastReplyAt: string | null;
  avgResponseMinutes: number | null;
}

export interface SupervisionOverview {
  slaMinutes: number;
  generatedAt: string;
  kpis: {
    waiting: number;
    waitingOverSla: number;
    unassignedWaiting: number;
    // Patients waiting more than a day (the "Gone cold" tab).
    goneCold: number;
    longestWaitMinutes: number;
    droppedHalfwayToday: number;
    flowsStartedToday: number;
    followUpsDue: number;
    avgFirstResponseMinutes: number | null;
    unansweredToday: number;
  };
  agents: SupervisionAgent[];
}

// Flow progress for a chat. STALLED = still "active" but idle over an hour.
export interface SupervisionFlowState {
  id: number;
  flowName: string | null;
  status: "ACTIVE" | "COMPLETED" | "HANDED_OFF" | "STOPPED" | "EXPIRED" | "FAILED" | "STALLED";
  droppedHalfway: boolean;
  answers: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
}

// waiting = started waiting in the last 24h; cold = waiting longer than that.
export type SupervisionFilter = "waiting" | "cold" | "halfway" | "follow_up" | "all";

// The same patient's chat on another line (the list shows one row per patient).
export interface SupervisionOtherChat {
  id: number;
  whatsappNumber: { id: number; label: string };
  status?: "OPEN" | "PENDING" | "RESOLVED";
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderType: "CUSTOMER" | "AGENT" | "BOT" | null;
  waitingMinutes: number | null;
  overSla: boolean;
  outcome: ConversationOutcome | null;
  assignedAgent: PersonRef | null;
}

export interface SupervisionConversation {
  id: number;
  customer: { id: number; name: string | null; phone: string };
  whatsappNumber: { id: number; label: string };
  assignedAgent: PersonRef | null;
  status: "OPEN" | "PENDING" | "RESOLVED";
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastSenderType: "CUSTOMER" | "AGENT" | "BOT" | null;
  lastAgentReplyAt: string | null;
  awaitingReplySince: string | null;
  // Working minutes (outside quiet hours) the patient has been waiting.
  waitingMinutes: number | null;
  overSla: boolean;
  outcome: ConversationOutcome | null;
  outcomeAt: string | null;
  outcomeBy: PersonRef | null;
  followUpAt: string | null;
  followUpOverdue: boolean;
  flow: SupervisionFlowState | null;
  noteCount: number;
  // This patient's other chats that match the same tab (other lines).
  otherChats: SupervisionOtherChat[];
}

export interface SupervisionTimeline {
  id: number;
  customer: { id: number; name: string | null; phone: string; tags: string[]; optedOut: boolean };
  whatsappNumber: { id: number; label: string };
  whatsappNumberId: number;
  assignedAgent: PersonRef | null;
  status: "OPEN" | "PENDING" | "RESOLVED";
  outcome: ConversationOutcome | null;
  outcomeAt: string | null;
  outcomeBy: PersonRef | null;
  followUpAt: string | null;
  awaitingReplySince: string | null;
  lastAgentReplyAt: string | null;
  waitingMinutes: number | null;
  overSla: boolean;
  slaMinutes: number;
  notes: ConversationNote[];
  flowRuns: SupervisionFlowState[];
  messages: {
    id: number;
    senderType: "CUSTOMER" | "AGENT" | "BOT";
    content: string;
    messageType: string;
    mediaUrl: string | null;
    status: string | null;
    createdAt: string;
    sender: PersonRef | null;
  }[];
  // This patient's chats on other lines.
  otherChats: SupervisionOtherChat[];
  // Each time the patient waited, and how long the reply took (working minutes).
  waits: { askedAt: string; repliedAt: string | null; repliedBy: string | null; minutes: number; stillWaiting: boolean }[];
  // Assignment / status / outcome changes, newest first.
  history: { action: string; actorUsername: string | null; details: Record<string, unknown> | null; createdAt: string }[];
}

// One line of the live dashboard feed. type is "patient_message",
// "agent_message", or an event: conversation.assigned / claimed /
// status_changed / outcome_set, flow.handed_off. details is the event's data
// (e.g. { agentUsername, previousAgentUsername }, { outcome }, { status }).
export interface SupervisionActivity {
  id: string;
  type: string;
  at: string;
  actor: PersonRef | null;
  conversationId: number;
  customer: { id: number; name: string | null; phone: string };
  line: { id: number; label: string };
  text: string | null;
  details: Record<string, unknown> | null;
}

// ── Supervisor report (PDF) ───────────────────────────────────────────────

export interface SupervisionReport {
  period: { from: string; to: string; fromDay: string; toDay: string; timezone: string };
  line: { id: number; label: string | null } | null;
  generatedAt: string;
  slaMinutes: number;
  summary: {
    chats: number;
    patientsWrote: number;
    patientMessages: number;
    staffReplies: number;
    firstResponses: number;
    avgFirstResponseMinutes: number | null;
    withinSlaPercent: number | null;
    lateResponses: number;
    unanswered: number;
    // Outcome changes made in the period: FOLLOW_UP / CLEARED (old periods may also
    // hold the legacy NOT_INTERESTED / NO_ANSWER / BOOKED, which the reports ignore).
    outcomes: Record<string, number>;
  };
  agents: {
    id: number;
    name: string | null;
    username: string;
    role: UserRole;
    isActive: boolean;
    chats: number;
    replies: number;
    firstResponses: number;
    avgResponseMinutes: number | null;
    lateResponses: number;
    outcomesSet: number;
  }[];
  campaigns: {
    id: number;
    name: string;
    line: string | null;
    status: CampaignStatus;
    startedAt: string | null;
    recipients: number;
    sent: number;
    failed: number;
    replied: number;
  }[];
  // Every chat with a message in the period.
  chats: {
    id: number;
    customer: { id: number; name: string | null; phone: string };
    line: string | null;
    assignedAgent: PersonRef | null;
    status: "OPEN" | "PENDING" | "RESOLVED";
    outcome: ConversationOutcome | null;
    messages: number;
    patientMessages: number;
    avgResponseMinutes: number | null;
    lateResponses: number;
    unanswered: boolean;
    lastMessageAt: string | null;
  }[];
  chatsTruncated: boolean;
}

export interface ReportTranscript {
  id: number;
  customer: { name: string | null; phone: string };
  line: string | null;
  assignedAgent: PersonRef | null;
  truncated: boolean;
  messages: { id: number; from: "patient" | "agent" | "bot" | "campaign"; sender: string | null; text: string; at: string }[];
}

// ── Detailed supervisor reports (/api/supervision/reports/*) ──────────────
// All take from/to (YYYY-MM-DD, clinic time zone, both days included, max 92
// days) and an optional numberId. People are plain display names here.

export interface DetailedReportMeta {
  period: { from: string; to: string; fromDay: string; toDay: string; timezone: string };
  numberId: number | null;
  generatedAt: string;
  slaMinutes: number;
}

/** Response-time bands, in working minutes. */
export type ResponseBandKey = "under5" | "5to15" | "15to30" | "30to60" | "over60";
export type ResponseBands = Record<ResponseBandKey, number>;

export interface TeamReportAgent {
  id: number;
  name: string | null;
  username: string;
  role: UserRole;
  isActive: boolean;
  activeDays: number;
  chatsHandled: number;
  replies: number;
  firstResponses: number;
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  p90ResponseMinutes: number | null;
  withinSlaPercent: number | null;
  lateResponses: number;
  responseBands: ResponseBands;
  /** Outcomes set: FOLLOW_UP / CLEARED (legacy NOT_INTERESTED / NO_ANSWER / BOOKED are ignored). */
  outcomes: Record<string, number>;
  notesWritten: number;
  openChatsNow: number;
}

export interface TeamReport extends DetailedReportMeta {
  team: {
    chats: number;
    patientMessages: number;
    staffReplies: number;
    firstResponses: number;
    avgResponseMinutes: number | null;
    medianResponseMinutes: number | null;
    p90ResponseMinutes: number | null;
    withinSlaPercent: number | null;
    lateResponses: number;
    unanswered: number;
    responseBands: ResponseBands;
  };
  agents: TeamReportAgent[];
  daily: {
    day: string;
    patientMessages: number;
    chats: number;
    staffReplies: number;
    avgFirstResponseMinutes: number | null;
    lateResponses: number;
    unanswered: number;
  }[];
  /** 24 entries, clinic time. */
  hourly: { hour: number; patientMessages: number; staffReplies: number }[];
}

export interface CampaignsReportCampaign {
  id: number;
  name: string;
  line: string | null;
  template: string | null;
  category: string | null;
  status: CampaignStatus;
  createdBy: string | null;
  approvedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number;
  read: number;
  replied: number;
  optOuts: number;
  /** Percentages of sent, one decimal; null when the base is 0. */
  rates: {
    delivered: number | null;
    read: number | null;
    replied: number | null;
    optOut: number | null;
  };
}

export interface CampaignsReport extends DetailedReportMeta {
  totals: {
    campaigns: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    optOuts: number;
  } | null;
  campaigns: CampaignsReportCampaign[];
}

export interface ChatsReportChat {
  id: number;
  patient: string | null;
  phone: string;
  tags: string[];
  optedOut: boolean;
  line: string | null;
  assignedTo: string | null;
  repliedBy: string[];
  status: "OPEN" | "PENDING" | "RESOLVED";
  outcome: ConversationOutcome | null;
  outcomeBy: string | null;
  followUpAt: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  patientMessages: number;
  staffMessages: number;
  botMessages: number;
  campaignMessages: number;
  firstResponses: number;
  avgResponseMinutes: number | null;
  longestWaitMinutes: number;
  lateResponses: number;
  unanswered: boolean;
  campaign: string | null;
  notes: number;
}

export interface ChatsReport extends DetailedReportMeta {
  summary: {
    chats: number;
    unanswered: number;
    withLateResponses: number;
    /** Outcome keys plus NONE. */
    byOutcome: Record<string, number>;
    byStatus: Record<string, number>;
    byLine: Record<string, number>;
  };
  chats: ChatsReportChat[];
  /** More than 5000 chats in the period — only the first are listed. */
  truncated: boolean;
}

// ── Marketing dashboard (GET /api/stats/marketing) ──────────────────────────
// Campaigns and flow runs STARTED in the period; every rate is a share of
// sent (one decimal, null when nothing was sent, never above 100).

export interface MarketingRates {
  deliveredPct: number | null;
  readPct: number | null;
  repliedPct: number | null;
  optOutPct: number | null;
}

export type MarketingFailReason =
  | "NOT_ON_WHATSAPP"
  | "OPTED_OUT"
  | "FREQUENCY_LIMIT"
  | "NOT_CONFIRMED"
  | "META_MARKETING_LIMIT"
  | "OTHER";

export interface MarketingFunnel {
  campaigns: number;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
  /** Still waiting for their turn (running, paused or scheduled campaigns). */
  pending: number;
  optOutsFromCampaigns: number;
  rates: MarketingRates;
  /** Failed and skipped recipients by reason, biggest first (up to 6). */
  failedReasons: { category: MarketingFailReason; label: string; count: number; example: string | null }[];
}

export interface MarketingCampaignRow {
  id: number;
  name: string;
  whatsappNumberId: number;
  line: string | null;
  template: string | null;
  category: string;
  status: CampaignStatus;
  /** Deleted after completing: counted, but there is no page to open. */
  deleted: boolean;
  startedAt: string;
  completedAt: string | null;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
  optOuts: number;
  rates: MarketingRates;
}

export interface MarketingFlowRow {
  id: number;
  name: string;
  isActive: boolean;
  started: number;
  completed: number;
  handedOff: number;
  dropped: number;
  active: number;
  failed: number;
  rates: { completedPct: number | null; handedOffPct: number | null; droppedPct: number | null };
  /** Most-picked buttons / list rows, counted once per run. */
  topChoices: { choice: string; runs: number }[];
}

export interface MarketingAudience {
  totalContacts: number;
  newContacts: number;
  reachable: number;
  optedOutTotal: number;
  optedOutGlobal: number;
  optedOutNew: number;
  /** Settings → Campaign safety; 0 = no limit. */
  frequencyCapDays: number;
  /** null when there is no frequency limit. */
  frequencyCappedNow: number | null;
  /** The period's campaigns grouped by where their audience came from, most sent first. */
  performance: MarketingAudienceRow[];
}

export interface MarketingAudienceRow {
  key: string;
  /** MANUAL = picked contacts, and every campaign created before lists were recorded. */
  kind: "SEGMENT" | "LIST" | "MANUAL";
  /** "Segment: ...", "List: ...", "Lists: ... + ..." or "Picked contacts". */
  label: string;
  segmentId: number | null;
  listIds: number[];
  campaigns: number;
  recipients: number;
  sent: number;
  replied: number;
  repliedPct: number | null;
  optOuts: number;
  optOutPct: number | null;
  failedSkipped: number;
  lastSentAt: string | null;
}

export interface MarketingLineHealth {
  id: number;
  label: string;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  metaStatus: string | null;
  qualityCheckedAt: string | null;
  /** null when Meta couldn't be asked. */
  messagingTier: string | null;
  messagingLimit: number | null;
  unlimited: boolean;
  usedLast24h: number;
  usedPct: number | null;
  templates: { pending: number; rejected: number; paused: number };
}

export interface MarketingAttention {
  pendingApproval: {
    count: number;
    campaigns: { id: number; name: string; whatsappNumberId: number; line: string | null; submittedAt: string | null; submittedBy: string | null; recipients: number }[];
  };
  rejectedRecently: { id: number; name: string; whatsappNumberId: number; line: string | null; reviewedAt: string | null; reviewedBy: string | null; reason: string | null }[];
  paused: {
    id: number; name: string; whatsappNumberId: number; line: string | null;
    reason: string | null; detail: string | null; resumeAt: string | null; pausedAt: string; sent: number; recipients: number;
  }[];
  templates: { id: number; name: string; status: "SUBMITTED" | "REJECTED" | "PAUSED"; reason: string | null; changedAt: string }[];
  /** "Recently" for rejections, in days. */
  recentDays: number;
}

export interface MarketingStats {
  period: { from: string; to: string; fromDay: string; toDay: string; timezone: string };
  numberId: number | null;
  generatedAt: string;
  definitions: { optOutWindowDays: number; stalledFlowMinutes: number };
  campaignFunnel: MarketingFunnel;
  campaigns: MarketingCampaignRow[];
  flows: MarketingFlowRow[];
  audience: MarketingAudience;
  lineHealth: MarketingLineHealth[];
  attention: MarketingAttention;
}
