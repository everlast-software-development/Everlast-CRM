import { Compass, KeyRound, Rocket, ShieldCheck, UserRound } from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { LISTED_ROLES, ROLE_LABEL, roleCan, type DocPage } from "../model";
import { Bullets, Callout, DocLink, H, Kbd, Lead, P, Shot, Steps, Table, Tiles, Ui } from "../primitives";

const GROUP = "Getting started";

// What each role is for, in one line — shown on the welcome page.
const ROLE_PURPOSE = {
  ADMIN: "You run the workspace: you see everything, approve campaigns, manage the team, WhatsApp lines and settings.",
  SUPERVISOR: "You answer patients like an agent, and you also watch the whole team: who is waiting, response times and reports.",
  AGENT: "You answer patients on WhatsApp, set follow-ups when you need to get back to someone and keep your chats moving.",
  MARKETING: "You build audiences, templates and campaigns. An admin approves each campaign before it is sent. You don't see patient chats.",
  DIRECTOR: "You follow how the clinic is doing: dashboards, reports, the team's performance and campaign results. Everything is read-only.",
} as const;

const welcome: DocPage = {
  key: "welcome",
  label: "Welcome",
  group: GROUP,
  icon: Rocket,
  description: "What Everlast CRM is and what you can do in it",
  keywords: "overview introduction start home",
  body: (ctx) => {
    const tiles = [
      ctx.can("conversation:write") && { to: "inbox", title: "Answer patients", text: "The inbox, replying, the 24-hour window and templates." },
      ctx.can("team:supervise") && { to: "supervision", title: "Watch the team", text: "Who's waiting, response times and every chat, live." },
      ctx.can("campaign:read") && { to: "campaigns", title: "Run campaigns", text: "Audiences, templates, approval and results." },
      ctx.can("contact:read") && { to: "contacts", title: "Manage contacts", text: "Patients, imports, lists and segments." },
      ctx.can("settings:write") && { to: "users", title: "Administer the workspace", text: "Users, WhatsApp lines, quiet hours and safety limits." },
      ctx.can("settings:write") && { to: "architecture", title: "Technical reference", text: "Architecture, deployment, environment and security." },
    ].filter(Boolean) as { to: string; title: string; text: string }[];

    return (
      <>
        <Lead>
          Everlast CRM is where the Everlast Wellness team talks to patients on WhatsApp. Messages from every clinic line arrive in one
          shared inbox. You answer there, follow up with patients, and run marketing campaigns to the patients who agreed to receive them.
        </Lead>
        <Callout tone="tip" title={`You're signed in as ${ROLE_LABEL[ctx.role]}`}>
          {ROLE_PURPOSE[ctx.role]} This guide only shows the pages that apply to you.
          {ctx.previewing && " (You are previewing another role's guide.)"}
        </Callout>
        <H>Where to start</H>
        <Tiles items={tiles} />
        <H>How it fits together</H>
        <Bullets items={[
            <><b>WhatsApp lines.</b> The clinic has several WhatsApp numbers. Each one is a line. The inbox, templates, campaigns and stats
              all follow the line picked in the top-right switcher.</>,
            <><b>Conversations.</b> One per patient per line. A patient writes, the chat shows up in the inbox, and someone on the team
              takes it.</>,
            <><b>Follow-ups.</b> When the team needs to get back to a patient, the agent sets a follow-up on the chat. It comes back as a
              reminder when due, and is cancelled automatically if the patient writes first.</>,
            <><b>Campaigns.</b> Approved WhatsApp templates sent to an audience (a list or a segment), within safety limits: quiet hours,
              a frequency cap, opt-outs and the number&apos;s quality.</>,
          ]} />
        <Shot name="inbox" alt="The inbox with demo conversations" caption="The inbox. Screenshots in this guide use demo data on a demo line." />
      </>
    );
  },
};

const signingIn: DocPage = {
  key: "signing-in",
  label: "Signing in",
  group: GROUP,
  icon: KeyRound,
  description: "Signing in, your session, signing out and the theme",
  keywords: "login password session logout dark mode theme expired",
  body: (ctx) => (
    <>
      <Lead>Every member of the team has their own account. An admin creates it and gives you a username and a password.</Lead>
      <Steps items={[
          <>Open the app. You&apos;ll land on the sign-in page.</>,
          <>Enter your <Ui>Username</Ui> and <Ui>Password</Ui>. Use <Ui>Show</Ui> to check what you typed.</>,
          <>Click <Ui>Sign in</Ui>. You go straight to your starting page:{" "}
            {ctx.can("conversation:write") ? "the Inbox." : ctx.can("campaign:read") ? "Campaigns." : "the first page your role can open."}</>,
        ]} />
      <Shot name="login" alt="The sign-in page" />
      <H>Your session</H>
      <Bullets items={[
          <>A session lasts <b>8 hours</b>. After that you&apos;re asked to sign in again, and the page shows that your session expired.</>,
          <>Too many wrong passwords lock that username out for a while: <b>10 failed attempts in 15 minutes</b>.</>,
          <>If an admin resets your password, changes your role or deactivates you, you&apos;re signed out everywhere at once.</>,
          <>Sign out with the <Ui>Sign out</Ui> button at the bottom of the left sidebar. It also sets you offline.</>,
        ]} />
      <H>Light and dark mode</H>
      <P>
        Use the sun, moon and screen buttons in the top bar to choose <b>Light</b>, <b>Dark</b> or <b>System</b> (follow your device).
        The choice is remembered in this browser only.
      </P>
      <Callout tone="note" title="Forgot your password?">
        {ctx.can("user:write")
          ? <>You can reset anyone&apos;s password in <DocLink to="users">Settings → Users</DocLink>. If you&apos;re the only admin and you&apos;re
              locked out, a developer can run <code>create-admin -- --reset</code> on the server (see <DocLink to="deployment">Deployment</DocLink>).</>
          : <>Ask an admin to reset it in Settings → Users. You&apos;ll be signed out everywhere and can sign in with the new password.</>}
      </Callout>
    </>
  ),
};

type NavRow = { label: string; perm: Permission | null; what: string };
const NAV: NavRow[] = [
  { label: "Inbox", perm: "conversation:write", what: "Patient chats on the current line. The badge counts unread chats." },
  { label: "Supervision", perm: "team:supervise", what: "Every agent's chats, waiting times, live wall and reports." },
  { label: "Contacts → Contacts / Lists / Segments", perm: "contact:read", what: "The patient database, saved lists and rule-based audiences." },
  { label: "Campaigns", perm: "campaign:read", what: "Campaigns and flows. For admins, the badge counts campaigns waiting for approval." },
  { label: "Documentation", perm: null, what: "This guide." },
  { label: "Dashboard", perm: "stats:read", what: "Activity at a glance. For marketing it opens the Marketing dashboard: campaign results, flows, audience, line health." },
  { label: "Templates", perm: "template:write", what: "WhatsApp message templates and their Meta approval status." },
  { label: "Media Library", perm: "media:write", what: "Images, video and documents for template headers." },
  { label: "Number Health", perm: "stats:read", what: "The line's quality rating and messaging limit from Meta." },
  { label: "Audit Log", perm: "audit:read", what: "Who did what, and when." },
  { label: "Settings", perm: "settings:write", what: "Users, WhatsApp lines, quiet hours, campaign safety." },
];

const navigation: DocPage = {
  key: "navigation",
  label: "Finding your way",
  group: GROUP,
  icon: Compass,
  description: "The sidebar, the line switcher and alerts",
  keywords: "sidebar menu number switcher line whatsapp notifications collapse",
  body: (ctx) => (
    <>
      <Lead>The left sidebar holds everything you can open. It only lists the pages your role can use, so nothing in it leads to an
        &ldquo;access denied&rdquo; screen.</Lead>
      <H>Your sidebar</H>
      <Table
        head={["Item", "What it's for"]}
        rows={NAV.filter((n) => !n.perm || ctx.can(n.perm)).map((n) => [<b key="l">{n.label}</b>, n.what])}
      />
      <P>
        On a computer, the sidebar is a slim column of icons. Hover an icon to see its name, or click <Ui>»</Ui> at the bottom to open the
        full menu. It folds away again when you pick a page, click outside it, or click <Ui>Collapse</Ui>. On a phone, use the <Kbd>☰</Kbd>{" "}
        menu button at the top.
      </P>
      <H>The WhatsApp line switcher</H>
      <P>
        The switcher in the top-right corner shows which clinic line you&apos;re working on. When there&apos;s more than one line, it
        shows a chip such as <Ui>+3 on other lines</Ui> when there&apos;s activity elsewhere. Open it to see each line&apos;s unread chats
        and waiting patients.
      </P>
      <Callout tone="warn">
        Switching lines changes the inbox, templates, campaigns and stats. A reply always goes out on the line the patient wrote to. If
        you open a chat that belongs to another line, switch to that line first.
      </Callout>
      {ctx.can("conversation:write") && (
        <>
          <H>Alerts</H>
          <P>
            Important events pop up as cards in the bottom-right corner, with a soft chime. Examples: a patient asking for a person, a
            possible medical concern, or a follow-up that&apos;s due. They stay until you dismiss them.
            Click <Ui>Enable desktop alerts</Ui> on a card to get them even when the tab is in the background. See{" "}
            <DocLink to="alerts">Hand-off alerts</DocLink>.
          </P>
        </>
      )}
    </>
  ),
};

const PERM_GROUPS: { label: string; perms: Permission[]; text: string }[] = [
  { label: "Read and answer chats", perms: ["conversation:read", "conversation:write", "message:send"], text: "Inbox, replying, follow-ups" },
  { label: "Assign chats", perms: ["conversation:assign"], text: "Give a chat to someone else" },
  { label: "View and edit contacts", perms: ["contact:read", "contact:write"], text: "Patient records" },
  { label: "Import contacts", perms: ["contact:import"], text: "CSV import" },
  { label: "Delete contacts", perms: ["contact:delete"], text: "Deletes their chat history too" },
  { label: "Manage lists and segments", perms: ["list:write", "segment:write"], text: "Build audiences" },
  { label: "Manage templates", perms: ["template:write"], text: "Create and submit WhatsApp templates" },
  { label: "See campaigns", perms: ["campaign:read"], text: "Campaign list and results" },
  { label: "Build campaigns and flows", perms: ["campaign:write"], text: "Draft, test-send, submit for approval" },
  { label: "Approve and send campaigns", perms: ["campaign:send"], text: "Approve, reject, send now, schedule" },
  { label: "Pause, resume and cancel campaigns", perms: ["campaign:control"], text: "Control a campaign that's running" },
  { label: "Media library", perms: ["media:write"], text: "Upload and manage files" },
  { label: "Dashboard and stats", perms: ["stats:read"], text: "Dashboard, Number Health" },
  { label: "Team stats", perms: ["stats:team"], text: "Agent performance on the Dashboard" },
  { label: "Marketing dashboard", perms: ["stats:marketing"], text: "Campaign funnel, flows, audience, line health" },
  { label: "Supervision", perms: ["team:supervise"], text: "Every agent's chats, live wall, reports" },
  { label: "Audit log", perms: ["audit:read"], text: "Who did what" },
  { label: "Manage users", perms: ["user:write"], text: "Create, edit, deactivate, reset passwords" },
  { label: "Workspace settings", perms: ["settings:write", "number:write"], text: "Lines, quiet hours, safety" },
  { label: "Lift an opt-out", perms: ["optout:lift"], text: "Re-subscribe a patient to marketing" },
];

const roles: DocPage = {
  key: "roles",
  label: "Roles & permissions",
  group: GROUP,
  icon: ShieldCheck,
  description: "The roles and exactly what each can do",
  keywords: "supervisor agent marketing access rights matrix",
  body: (ctx) => (
    <>
      <Lead>
        Every account has one role. The role decides which pages you see and what the server lets you do.
        {LISTED_ROLES.includes(ctx.role) && " Your column is highlighted."}
      </Lead>
      <Table
        head={["Ability", ...LISTED_ROLES.map((r) => ROLE_LABEL[r])]}
        highlightCol={LISTED_ROLES.includes(ctx.role) ? LISTED_ROLES.indexOf(ctx.role) + 1 : undefined}
        rows={PERM_GROUPS.filter((g) => LISTED_ROLES.some((r) => roleCan(r)(...g.perms))).map((g) => [
          <span key="a"><b>{g.label}</b><br /><span className="text-gray-400 text-[12px]">{g.text}</span></span>,
          ...LISTED_ROLES.map((r) => (roleCan(r)(...g.perms) ? <span key={r} className="text-brand-fg font-bold">✓</span> : <span key={r} className="text-gray-300">—</span>)),
        ])}
      />
      <H>The roles in short</H>
      <Bullets items={[
          <><b>Supervisor</b>: an agent who also watches the team on the Supervision page and reads campaigns and stats.</>,
          <><b>Agent</b>: the inbox and contacts. No campaigns and no stats.</>,
          <><b>Marketing</b>: contacts, lists, segments, templates, media and campaigns. Never sees patient chats, and every campaign
            needs an admin&apos;s approval.</>,
        ]} />
      <Callout tone="note">
        The server checks every action, whatever the screen shows. Hiding a button is only a courtesy. If your role changes, you&apos;re
        signed out and see the new set of pages next time.
      </Callout>
    </>
  ),
};

const account: DocPage = {
  key: "account",
  label: "Your account",
  group: GROUP,
  icon: UserRound,
  description: "Your name, password and presence status",
  keywords: "profile password change name status online break",
  body: (ctx) => (
    <>
      <Lead>Your display name is what colleagues see on assignments, replies and reports.</Lead>
      {ctx.can("settings:write") ? (
        <>
          <P>
            Open <b>Settings → My account</b>. Change your <Ui>Display name</Ui> (up to 60 characters) and click <Ui>Save name</Ui>. To
            change your password, enter the <Ui>Current password</Ui> and the new one twice (at least 8 characters), then click{" "}
            <Ui>Change password</Ui>. Your other devices are signed out.
          </P>
          <Shot name="settings-account" alt="Settings, My account" />
        </>
      ) : (
        <Callout tone="note" title="Changing your name or password">
          Only admins can reach the My account page, which lives in Settings. Ask an admin to change your display name or to reset your
          password.
        </Callout>
      )}
      {ctx.can("conversation:write") && (
        <>
          <H>Your status: Online, On break, Offline</H>
          <P>
            Your status sits at the bottom of the inbox list. Click it to switch between <Ui>Online</Ui> and <Ui>On break</Ui>.{" "}
            <b>Offline is automatic</b>: about a minute after you close the app. Colleagues and supervisors see your status when they
            assign chats.
          </P>
          <Shot name="agent-status-menu" alt="The status menu at the bottom of the inbox" />
          <P>
            At the end of a shift, use <Ui>Hand over my chats…</Ui> in the same menu. See{" "}
            <DocLink to="ownership">Assigning & status</DocLink>.
          </P>
        </>
      )}
    </>
  ),
};

export const startPages: DocPage[] = [welcome, signingIn, navigation, roles, account];
