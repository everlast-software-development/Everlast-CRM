"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, startTransition } from "react";
import type { ReactNode } from "react";
import {
  MessageSquare,
  Eye,
  Megaphone,
  Contact,
  LayoutDashboard,
  Settings,
  ClipboardList,
  LayoutTemplate,
  Images,
  ShieldCheck,
  ChevronsRight,
  ChevronsLeft,
  ChevronDown,
  Menu,
  X,
  LogOut,
  BookMarked,
} from "lucide-react";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { apiLogout, apiGetLineCounts, apiGetPendingApprovals } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WhatsAppNumberProvider, useActiveNumber } from "@/components/WhatsAppNumberProvider";
import { NumberSwitcher } from "@/components/NumberSwitcher";
import { ThemeSwitcher, ThemeToggleButton } from "@/components/ThemeToggle";
import { CurrentUserProvider, useCurrentUser } from "@/components/CurrentUserProvider";
import { ToastProvider } from "@/components/ui/toast";
import DevCostTracker from "@/components/DevCostTracker";
import TemplateStatusWatcher from "@/components/TemplateStatusWatcher";
import HandoffNotifier from "@/components/HandoffNotifier";
import { MyStatusMenu } from "@/components/MyStatusMenu";


const COLLAPSED_W = "w-14";   // 56px icon rail
const EXPANDED_W  = "w-[260px]";

// The provider sits ABOVE the shell so the switcher itself is outside the
// remount boundary below — switching must not unmount the control you just used.
// Rendered inside CurrentUserProvider so it can ask for the permission.
// Collapsed sidebar: names an icon on hover / keyboard focus, to the right of
// it. Off when the sidebar is expanded — the label is already on screen.
function SideTip({ label, show, children }: { label: string; show: boolean; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-[12.5px] font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const ROLE_WORDS: Record<string, string> = { ADMIN: "Admin", MARKETING: "Marketing", SUPERVISOR: "Supervisor", AGENT: "Agent", DIRECTOR: "Director" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

// Who is signed in, at the bottom of the main sidebar: name, role and — for
// the people who work the inbox in shifts — their status and hand-over menu.
// Admins don't take breaks or hand over a queue, so they just see their role.
// Collapsed, it's the initials; clicking them opens the sidebar.
function SidebarUser({ expanded, onExpand }: { expanded: boolean; onExpand?: () => void }) {
  const { me, can } = useCurrentUser();
  if (!me) return null;
  const display = me.name || me.username;
  const role = ROLE_WORDS[me.role] ?? me.role;
  // Status and hand-over are for people who work the inbox, admins aside.
  const showsStatus = me.role !== "ADMIN" && can("conversation:write");
  const avatar = (
    <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white font-semibold text-[12px] shrink-0">
      {initials(display)}
    </div>
  );
  if (!expanded) {
    return (
      <SideTip show label={`${display} · ${role}`}>
        <button type="button" onClick={onExpand} aria-label={`${display}, ${role}`} className="flex w-full justify-center py-1 rounded-xl hover:bg-gray-50">
          {avatar}
        </button>
      </SideTip>
    );
  }
  return (
    <div className="flex items-center gap-3 px-2 py-1">
      {avatar}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 leading-snug truncate" title={me.username}>{display}</p>
        {showsStatus ? (
          <MyStatusMenu roleLabel={role} menuClassName="-left-12 bottom-8" />
        ) : (
          <p className="text-[12px] text-gray-500 leading-snug">{role}</p>
        )}
      </div>
    </div>
  );
}

function AdminDevCostTracker() {
  const { can } = useCurrentUser();
  return can("dev:tools") ? <DevCostTracker /> : null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WhatsAppNumberProvider>
      <CurrentUserProvider>
        <DashboardShell>{children}</DashboardShell>
        {/* Dev-only, admin-only message/cost tracker; compiled out of production builds. */}
        {process.env.NODE_ENV === "development" && <AdminDevCostTracker />}
      </CurrentUserProvider>
    </WhatsAppNumberProvider>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const { activeNumberId } = useActiveNumber();
  const pathname = usePathname();
  const router = useRouter();
  const { can } = useCurrentUser();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Tagged with the number it was fetched for, so a count belonging to the
  // previous number can never be displayed — it is simply ignored once the
  // active number no longer matches, rather than reset from inside an effect.
  const [unread, setUnread] = useState<{ numberId: string | null; count: number }>({
    numberId: null,
    count: 0,
  });
  const unreadCount = unread.numberId === activeNumberId ? unread.count : 0;
  // Templates Meta approved/rejected since this browser last opened /templates.
  const [templateUpdates, setTemplateUpdates] = useState(0);
  // Campaigns waiting for an admin's approval, across every number.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const canApprove = can("campaign:send");
  const [contactsOpen, setContactsOpen] = useState(pathname.startsWith("/customers"));

  // Keep the Contacts sub-menu expanded whenever the user is on one of its pages.
  useEffect(() => {
    if (pathname.startsWith("/customers")) setContactsOpen(true);
  }, [pathname]);

  // The desktop drawer opens and closes only from its toggle button (or the
  // Contacts item); hovering does nothing. It overlays the page, so it folds
  // back to the icon rail after you navigate or click the backdrop.
  function toggleExpanded() {
    setExpanded((v) => !v);
  }

  const [expandedPath, setExpandedPath] = useState(pathname);
  if (expandedPath !== pathname) {
    setExpandedPath(pathname);
    setExpanded(false);
  }

  async function handleLogout() {
    document.cookie = "logged_in=; path=/; max-age=0";
    localStorage.removeItem("user");
    try { await apiLogout(); } catch {}
    disconnectSocket();
    router.push("/login");
  }


  // The sidebar renders outside the key-remount below, so unlike every page this
  // effect does NOT re-run on its own when the number changes — activeNumberId is
  // in the dep array for exactly that reason. See `unread` above for why a stale
  // count cannot flash while the refetch is in flight.
  const readsChats = can("conversation:read");
  useEffect(() => {
    if (!readsChats) return; // no inbox, no badge (and the endpoint would 403)
    const forNumber = activeNumberId;
    function fetchUnread() {
      // Unread CHATS, not messages — the badge works like WhatsApp's. Read from
      // the line counts (conversation:read, like the inbox itself) rather than
      // /stats/overview, which needs stats:read and so 403'd for every AGENT.
      apiGetLineCounts()
        .then((res) => {
          const line = res.data.find((l) => String(l.id) === forNumber);
          setUnread({ numberId: forNumber, count: line?.unreadChats ?? 0 });
        })
        .catch(() => {});
    }
    fetchUnread();
    const socket = getSocket();
    socket.on("message.new", fetchUnread);
    socket.on("conversation.updated", fetchUnread);
    return () => {
      socket.off("message.new", fetchUnread);
      socket.off("conversation.updated", fetchUnread);
    };
  }, [activeNumberId, readsChats]);

  // Only admins approve, so only they get the badge. Counted across all numbers
  // (a submission on another line must not go unseen), refreshed on the
  // submit / approve / reject events of the line in view and every minute for
  // the others.
  useEffect(() => {
    if (!canApprove) return;
    function fetchPending() {
      apiGetPendingApprovals()
        .then((res) => setPendingApprovals(res.total))
        .catch(() => {});
    }
    fetchPending();
    const timer = setInterval(fetchPending, 60_000);
    const socket = getSocket();
    const events = ["campaign.submitted", "campaign.approved", "campaign.rejected"];
    events.forEach((e) => socket.on(e, fetchPending));
    return () => {
      clearInterval(timer);
      events.forEach((e) => socket.off(e, fetchPending));
    };
  }, [canApprove]);

  // Auto-close on navigation
  useEffect(() => {
    startTransition(() => {
      setExpanded(false);
      setMobileOpen(false);
    });
  }, [pathname]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Each link names the permission that opens its page, and is shown only to
  // users who hold it — so the sidebar can never offer a page that would then
  // say "access denied". The Inbox needs conversation:WRITE, not read: MARKETING
  // may read conversations for context elsewhere, but the inbox is for replying.
  const navBeforeContacts = [
    { href: "/chats",            icon: MessageSquare,   label: "Inbox",        enabled: true,  badge: unreadCount > 0 ? unreadCount : undefined, perm: "conversation:write" as const },
    // Every agent's chats and who is waiting (supervisors, admins).
    { href: "/supervision",      icon: Eye,             label: "Supervision",  enabled: true,  perm: "team:supervise" as const },
  ].filter((i) => can(i.perm));
  const navAfterContacts = [
    { href: "/campaigns",        icon: Megaphone,       label: "Campaigns",    enabled: true, perm: "campaign:read" as const, badge: canApprove && pendingApprovals > 0 ? pendingApprovals : undefined },
    // The in-app guide. Everyone gets it; its pages follow the reader's permissions.
    { href: "/docs",             icon: BookMarked,      label: "Documentation", enabled: true, perm: null },
  ].filter((i) => !i.perm || can(i.perm));
  const showContacts = can("contact:read");
  const contactsActive = isActive("/customers");
  const listsActive = isActive("/customers/lists");
  const segmentsActive = isActive("/customers/segments");
  const contactsChildActive = contactsActive && !listsActive && !segmentsActive;
  // The management screens. Headed "Manage" rather than "Admin" now that
  // MARKETING sees most of them too.
  const adminNav = [
    // MARKETING's Dashboard is the Marketing dashboard (no agent performance);
    // admins reach it from a tab on the Dashboard.
    { href: can("stats:marketing") && !can("stats:team") ? "/dashboard/marketing" : "/dashboard", icon: LayoutDashboard, label: "Dashboard", perm: "stats:read" as const },
    { href: "/templates", icon: LayoutTemplate,  label: "Templates",     perm: "template:write" as const, badge: templateUpdates > 0 ? templateUpdates : undefined },
    { href: "/media-library", icon: Images,      label: "Media Library", perm: "media:write" as const },
    { href: "/number-health", icon: ShieldCheck, label: "Number Health", perm: "stats:read" as const },
    { href: "/audit",     icon: ClipboardList,   label: "Audit Log",     perm: "audit:read" as const },
    // Users, WhatsApp numbers, quiet hours, campaign safety, my account.
    // Admin only; Team & Access lives here now (/team redirects).
    { href: "/settings",  icon: Settings,        label: "Settings",      perm: "settings:write" as const },
  ].filter((i) => can(i.perm));

  /* ── desktop nav item: icon + label that fades in on expand ── */
  const DesktopItem = ({
    href, icon: Icon, label, enabled = true, badge,
  }: { href: string|null; icon: React.ElementType; label: string; enabled?: boolean; badge?: number }) => {
    const active = href ? isActive(href) : false;
    const base   = "relative flex items-center h-10 w-full rounded-xl transition-colors overflow-hidden";
    const badgeLabel = badge ? (badge > 99 ? "99+" : String(badge)) : null;

    const iconEl = (
      <span className="relative shrink-0 flex items-center justify-center">
        <Icon className="w-[18px] h-[18px]" />
        {badgeLabel && !expanded && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none px-[3px]">
            {badgeLabel}
          </span>
        )}
      </span>
    );

    const labelEl = (
      <span
        className={`text-[13.5px] font-medium whitespace-nowrap transition-[opacity,max-width] duration-200 delay-75 ${
          expanded ? "opacity-100 max-w-[200px]" : "opacity-0 max-w-0 pointer-events-none"
        }`}
      >
        {label}
      </span>
    );

    const badgeEl = badgeLabel && expanded ? (
      <span className="ml-auto shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1.5">
        {badgeLabel}
      </span>
    ) : null;

    if (!enabled || !href) {
      return (
        <SideTip show={!expanded} label={label}>
          <div className={`${base} ${expanded ? "gap-3 px-3" : "justify-center"} text-gray-300 cursor-default`}>
            {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-r-full" />}
            {iconEl}
            {labelEl}
            {badgeEl}
          </div>
        </SideTip>
      );
    }
    return (
      <SideTip show={!expanded} label={badgeLabel ? `${label} · ${badgeLabel}` : label}>
        <Link
          href={href}
          aria-label={!expanded ? label : undefined}
          className={`${base} ${expanded ? "gap-3 px-3" : "justify-center"} ${
            active
              ? "bg-brand-100 text-brand-fg"
              : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          }`}
        >
          {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-r-full" />}
          {iconEl}
          {labelEl}
          {badgeEl}
        </Link>
      </SideTip>
    );
  };

  /* ── mobile nav item (always shows text) ── */
  const MobileItem = ({
    href, icon: Icon, label, enabled = true, badge,
  }: { href: string|null; icon: React.ElementType; label: string; enabled?: boolean; badge?: number }) => {
    const active = href ? isActive(href) : false;
    const badgeLabel = badge ? (badge > 99 ? "99+" : String(badge)) : null;
    if (!enabled || !href) {
      return (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] text-gray-300 cursor-default">
          <Icon className="w-[17px] h-[17px] shrink-0" />
          <span>{label}</span>
        </div>
      );
    }
    return (
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] transition-colors ${
          active ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-600 hover:bg-gray-50"
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-r-full" />}
        <Icon className="w-[17px] h-[17px] shrink-0" />
        <span className="flex-1">{label}</span>
        {badgeLabel && (
          <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1.5">
            {badgeLabel}
          </span>
        )}
      </Link>
    );
  };

  /* ── desktop Contacts item: expands into a Contacts / Lists sub-menu ── */
  const DesktopContactsNav = () => (
    <div>
      <SideTip show={!expanded} label="Contacts">
      <button
        type="button"
        onClick={() => {
          if (!expanded) setExpanded(true);
          setContactsOpen((v) => !v);
        }}
        aria-label={!expanded ? "Contacts" : undefined}
        className={`relative flex items-center h-10 w-full rounded-xl transition-colors overflow-hidden ${
          expanded ? "gap-3 px-3" : "justify-center"
        } ${contactsActive ? "bg-brand-100 text-brand-fg" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"}`}
      >
        {contactsActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-r-full" />}
        <span className="relative shrink-0 flex items-center justify-center">
          <Contact className="w-[18px] h-[18px]" />
        </span>
        <span
          className={`flex-1 text-left text-[13.5px] font-medium whitespace-nowrap transition-[opacity,max-width] duration-200 delay-75 ${
            expanded ? "opacity-100 max-w-[200px]" : "opacity-0 max-w-0 pointer-events-none"
          }`}
        >
          Contacts
        </span>
        {expanded && (
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${contactsOpen ? "rotate-180" : ""}`} />
        )}
      </button>
      </SideTip>

      {expanded && (
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
            contactsOpen ? "max-h-36 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="mt-0.5 ml-[29px] pl-2.5 border-l border-gray-100 space-y-0.5">
            <Link
              href="/customers"
              className={`relative flex items-center h-8 px-2.5 rounded-lg text-[13px] transition-colors ${
                contactsChildActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
              }`}
            >
              Contacts
            </Link>
            {can("list:read") && (
              <Link
                href="/customers/lists"
                className={`relative flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] transition-colors ${
                  listsActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                }`}
              >
                Lists
              </Link>
            )}
            {can("segment:read") && (
              <Link
                href="/customers/segments"
                className={`relative flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] transition-colors ${
                  segmentsActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                }`}
              >
                Segments
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );

  /* ── mobile Contacts item: same accordion, always-visible text ── */
  const MobileContactsNav = () => (
    <div>
      <button
        type="button"
        onClick={() => setContactsOpen((v) => !v)}
        className={`relative flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13.5px] transition-colors ${
          contactsActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-600 hover:bg-gray-50"
        }`}
      >
        {contactsActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-r-full" />}
        <Contact className="w-[17px] h-[17px] shrink-0" />
        <span className="flex-1 text-left">Contacts</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${contactsOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
          contactsOpen ? "max-h-44 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="mt-0.5 mb-0.5 ml-[22px] pl-2.5 border-l border-gray-100 space-y-0.5">
          <Link
            href="/customers"
            onClick={() => setMobileOpen(false)}
            className={`relative flex items-center px-3 py-2 rounded-lg text-[13px] transition-colors ${
              contactsChildActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            Contacts
          </Link>
          {can("list:read") && (
            <Link
              href="/customers/lists"
              onClick={() => setMobileOpen(false)}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                listsActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              Lists
            </Link>
          )}
          {can("segment:read") && (
            <Link
              href="/customers/segments"
              onClick={() => setMobileOpen(false)}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                segmentsActive ? "bg-brand-100 text-brand-fg font-medium" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              Segments
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <TooltipProvider>
    <ToastProvider>
    <>
      {can("template:write") && <TemplateStatusWatcher onCount={setTemplateUpdates} />}
      {can("conversation:write") && <HandoffNotifier />}
      {/* ══════════════ MOBILE ══════════════ */}

      {/* top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-white border-b border-gray-100 flex items-center px-4 gap-3">
        <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
        <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-xs leading-none">E</span>
        </div>
        <span className="font-bold text-[14px] text-gray-800">Everlast CRM</span>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggleButton />
          <NumberSwitcher />
        </div>
      </div>

      {/* mobile backdrop */}
      <div
        onClick={() => setMobileOpen(false)}
        className={`lg:hidden fixed inset-0 z-50 bg-black/30 transition-opacity duration-300 ${mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* mobile drawer */}
      <div className={`lg:hidden fixed top-0 left-0 h-full w-[260px] z-[51] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm leading-none">E</span>
            </div>
            <span className="font-bold text-[15px] text-gray-800">Everlast CRM</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navBeforeContacts.map((item) => <MobileItem key={item.label} {...item} />)}
          {showContacts && <MobileContactsNav />}
          {navAfterContacts.map((item) => <MobileItem key={item.label} {...item} />)}
          {adminNav.length > 0 && (
            <>
              <p className="px-3 pt-5 pb-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Manage</p>
              {adminNav.map((item) => <MobileItem key={item.label} {...item} />)}
            </>
          )}
        </nav>
        <div className="shrink-0 border-t border-gray-100 p-2 space-y-1">
          <SidebarUser expanded />
          <ThemeSwitcher withLabels />
          <button
            onClick={() => { setMobileOpen(false); handleLogout(); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13.5px] text-gray-600 hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
          >
            <LogOut className="w-[17px] h-[17px] shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {/* ══════════════ DESKTOP ══════════════ */}

      {/* expanded backdrop (behind drawer, in front of content) */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          className="hidden lg:block fixed inset-0 z-[39] bg-black/10"
        />
      )}

      {/* icon rail → full drawer */}
      <div
        className={`hidden lg:flex fixed top-0 left-0 h-full flex-col bg-white border-r border-gray-100 z-40 overflow-hidden transition-[width] duration-300 ease-in-out ${expanded ? EXPANDED_W : COLLAPSED_W}`}
      >
        {/* Logo row */}
        <div className={`shrink-0 flex items-center border-b border-gray-100 h-[57px] overflow-hidden transition-[padding] duration-300 ${expanded ? "px-4 gap-2.5" : "justify-center"}`}>
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm leading-none">E</span>
          </div>
          <span className={`font-bold text-[15px] text-gray-800 whitespace-nowrap transition-[opacity,max-width] duration-200 delay-75 ${expanded ? "opacity-100 max-w-[180px]" : "opacity-0 max-w-0"}`}>
            Everlast CRM
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navBeforeContacts.map((item) => <DesktopItem key={item.label} {...item} />)}
          {showContacts && <DesktopContactsNav />}
          {navAfterContacts.map((item) => <DesktopItem key={item.label} {...item} />)}
          {adminNav.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-2 mx-1" />
              {expanded && (
                <p className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Manage</p>
              )}
              {adminNav.map((item) => <DesktopItem key={item.label} {...item} />)}
            </>
          )}
        </nav>

        {/* Expand / collapse toggle */}
        <div className="shrink-0 border-t border-gray-100 p-2">
          <SideTip show={!expanded} label="Expand menu">
          <button
            onClick={toggleExpanded}
            aria-label={expanded ? "Collapse menu" : "Expand menu"}
            className={`flex items-center h-10 w-full rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors overflow-hidden ${expanded ? "gap-3 px-3" : "justify-center"}`}
          >
            {expanded
              ? <ChevronsLeft  className="w-[18px] h-[18px] shrink-0" />
              : <ChevronsRight className="w-[18px] h-[18px] shrink-0" />}
            <span className={`text-[13.5px] whitespace-nowrap transition-[opacity,max-width] duration-200 delay-75 ${expanded ? "opacity-100 max-w-[180px]" : "opacity-0 max-w-0"}`}>
              Collapse
            </span>
          </button>
          </SideTip>
        </div>

        {/* Signed-in user */}
        <div className="shrink-0 border-t border-gray-100 p-2">
          <SidebarUser expanded={expanded} onExpand={toggleExpanded} />
        </div>

        {/* Logout */}
        <div className="shrink-0 border-t border-gray-100 p-2">
          <SideTip show={!expanded} label="Sign out">
          <button
            onClick={handleLogout}
            aria-label={!expanded ? "Sign out" : undefined}
            className={`flex items-center h-10 w-full rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors overflow-hidden ${expanded ? "gap-3 px-3" : "justify-center"}`}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span className={`text-[13.5px] whitespace-nowrap transition-[opacity,max-width] duration-200 delay-75 ${expanded ? "opacity-100 max-w-[180px]" : "opacity-0 max-w-0"}`}>
              Sign out
            </span>
          </button>
          </SideTip>
        </div>
      </div>

      {/* ── main content ── */}
      {/* Keying the content on the active number remounts the entire dashboard
          subtree on a switch. In an app with no data-fetching library there is no
          cache to invalidate, so this one line IS the re-scoping: every useState
          resets and all ~30 effects re-run under the new number, with no
          per-page changes and no chance of a page being forgotten.

          It also deletes the state that stale-data bugs live in — the campaign
          progress Math.max guards and the chats page's conversation lookup.

          Requests already in flight are handled separately, in lib/api.ts: the
          remount does not cancel them. Do not remove one without the other. */}
      <div className="lg:ml-14 pt-12 lg:pt-0 h-screen flex flex-col overflow-hidden">
        {/* Desktop top bar. Deliberately OUTSIDE the keyed div below: if the
            switcher lived inside it, choosing a number would unmount the very
            menu you just clicked. (Mobile has its own bar, above.)

            Its 48px is taken from the page's height, not added to it — pages
            size themselves with h-full / min-h-full against the flex-1 region
            below, never with min-h-screen, or their bottom edge would be pushed
            under the fold. */}
        <header className="hidden lg:flex h-12 shrink-0 items-center justify-end gap-3 px-4 border-b border-gray-100 bg-white">
          <ThemeSwitcher />
          <NumberSwitcher />
        </header>

        <div
          key={activeNumberId ?? "default"}
          className="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          {children}
        </div>
      </div>
    </>
    </ToastProvider>
    </TooltipProvider>
  );
}
