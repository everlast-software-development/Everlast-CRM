import { Bell, CalendarClock, Clock, Contact, Inbox, MessageSquareText, Ban, UserCheck } from "lucide-react";
import { rolesWith, type DocCtx, type DocPage } from "../model";
import { Bullets, Callout, DocLink, H, Kbd, Lead, P, Shot, Steps, Table, Ui, Who } from "../primitives";

const GROUP = "Inbox";
const inboxUser = (ctx: DocCtx) => ctx.can("conversation:write");

const inbox: DocPage = {
  key: "inbox",
  label: "The inbox",
  group: GROUP,
  icon: Inbox,
  description: "Tabs, filters and what each chat row tells you",
  keywords: "chats conversations unread mine unassigned campaign replies follow-ups waiting search",
  visible: inboxUser,
  body: (ctx) => (
    <>
      <Who roles={rolesWith("conversation:write")} />
      <Lead>
        The inbox lists every WhatsApp conversation on the current line, newest message first. Click a chat to open it on the right.
      </Lead>
      <Shot name={ctx.role === "AGENT" ? "agent-inbox" : "inbox"} alt="The inbox" />
      <H>Tabs</H>
      <Table
        head={["Tab", "Shows"]}
        rows={[
          [<Ui key="t">All</Ui>, "Every chat, resolved ones included."],
          [<Ui key="t">Mine</Ui>, "Chats assigned to you that aren't resolved."],
          [<Ui key="t">Unassigned</Ui>, "Open chats nobody owns yet. The amber badge counts them. Start here when you're free."],
          [<Ui key="t">Campaign replies</Ui>, "Patients who answered a campaign and whose chat isn't resolved."],
          [<Ui key="t">Follow-ups</Ui>, "Chats you set to follow up, soonest first. The red badge counts the ones due now."],
        ]}
      />
      <P>
        Under the tabs, the <Ui>All</Ui> · <Ui>Unread</Ui> · <Ui>Window closed</Ui> pills narrow the chats already loaded. The search
        box (<Ui>Search by name or number...</Ui>) searches every chat on the line on the server, not just what&apos;s on screen. The list
        loads 50 chats at a time; scroll down for more.
      </P>
      <H>Reading a chat row</H>
      <Bullets
        items={[
          <>The <b>name</b> (or number), the time of the last message and a preview. <b>&ldquo;You:&rdquo;</b> means an agent wrote last.
            A <b>⚡</b> means an automation (a flow) wrote last.</>,
          <>A green <b>number bubble</b> counts unread messages.</>,
          <><b>Waiting</b> timer: how long the patient has waited for a reply. Grey under 15 minutes, <span className="text-amber-600 font-semibold">amber from 15</span>, <span className="text-red-600 font-semibold">red from 30</span>.</>,
          <>The owner&apos;s initials, or an amber <b>Unassigned</b>.</>,
          <>A red row with <b>Window closed</b>: the patient last wrote more than 24 hours ago. Only templates can be sent. See{" "}
            <DocLink to="window">The 24-hour window</DocLink>.</>,
          <>Chips for <b>Pending</b> / <b>Resolved</b> and <b>Follow up</b> when a follow-up is set. An overdue follow-up turns red.</>,
        ]}
      />
      <Callout tone="tip">
        Drag the edge of the chat list to make it wider (up to 30% of the window). Double-click the edge to reset it.
      </Callout>
      <H>Searching messages</H>
      <P>
        To find a message by its text across every chat on the line, open <b>/search</b>. It shows the 20 most recent matches, each with
        a link to its conversation. To search inside one chat, use <Ui>Search</Ui> in its contact panel.
      </P>
    </>
  ),
};

const chatting: DocPage = {
  key: "chatting",
  label: "Replying to patients",
  group: GROUP,
  icon: MessageSquareText,
  description: "Text, emoji, files, message status and the message menu",
  keywords: "send message reply media image pdf attach emoji delete copy quote ticks read delivered",
  visible: inboxUser,
  body: () => (
    <>
      <Who roles={rolesWith("message:send")} />
      <Lead>Open a chat from the inbox. The header shows the patient, the chat&apos;s status, its follow-up and who owns it.</Lead>
      <Shot name="chat" alt="An open conversation" />
      <H>Sending text</H>
      <Bullets
        items={[
          <>Type in <Ui>Type a message...</Ui> and press <Kbd>Enter</Kbd> (or click <Ui>Send</Ui>). <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> adds a new line.</>,
          <>The smiley button opens the emoji picker.</>,
          <>While you type, the patient sees WhatsApp&apos;s &ldquo;typing…&rdquo;. Colleagues looking at the same chat see that you&apos;re typing.</>,
          <>A double click or a double <Kbd>Enter</Kbd> still sends the message only once.</>,
        ]}
      />
      <H>Sending files</H>
      <Steps
        items={[
          <>Click the paperclip, or drag files onto the chat (you&apos;ll see <b>Drop files to send</b>).</>,
          <>In the preview, add an optional caption for each file. Use <b>+</b> to add more files and <b>×</b> to remove one.</>,
          <>Click send. Each caption goes out as a short text just before its file.</>,
        ]}
      />
      <P>
        Allowed: images, MP4/3GPP video, audio, PDF, Word and Excel, up to <b>16 MB</b> per file.
      </P>
      <H>Message status</H>
      <Table
        head={["Mark", "Meaning"]}
        rows={[
          ["Animated dots", "Sending"],
          ["✓", "Sent to WhatsApp"],
          ["✓✓", "Delivered to the patient's phone"],
          [<span key="r" className="text-sky-600 font-bold">✓✓</span>, "Read"],
          [<span key="f" className="text-red-600 font-bold">!</span>, "Not delivered. Hover it for the reason."],
        ]}
      />
      <P>
        Your messages are green and show your name. Automation messages are grey with an <b>Automation</b> label. A patient&apos;s reply to a campaign shows <b>Reply to &ldquo;campaign name&rdquo;</b> above it.
      </P>
      <H>The message menu</H>
      <P>Hover a message and click the small arrow to:</P>
      <Bullets
        items={[
          <><Ui>Reply</Ui>: quote it. A bar appears above the composer; × cancels it.</>,
          <><Ui>Copy</Ui>: copy the text.</>,
          <><Ui>Delete</Ui>: only your own sent messages. It removes the message here, but <b>WhatsApp can&apos;t recall it</b>. The
            patient&apos;s copy stays.</>,
        ]}
      />
      <H>Replying in a colleague&apos;s chat</H>
      <P>
        If the chat belongs to someone else, you&apos;re asked once: <b>&ldquo;This chat is assigned to …&rdquo;</b>. Click{" "}
        <Ui>Reply anyway</Ui> to send. The owner sees your reply in their chat.
      </P>
    </>
  ),
};

const windowPage: DocPage = {
  key: "window",
  label: "The 24-hour window",
  group: GROUP,
  icon: Clock,
  description: "When you can send free text, and when only templates",
  keywords: "24h window closed template re-engagement approved meta",
  visible: inboxUser,
  body: () => (
    <>
      <Lead>
        WhatsApp only lets a business send free-form messages within <b>24 hours of the patient&apos;s last message</b>. After that,
        you can only start the conversation again with a template Meta has approved.
      </Lead>
      <Shot name="chat-window-closed" alt="A chat whose 24-hour window has closed" caption="Window closed: the composer is locked and the Template button turns red." />
      <H>When the window is closed</H>
      <Bullets
        items={[
          <>The composer is disabled and says <b>Messaging disabled — 24h window closed</b>.</>,
          <>A contact who has never written counts as closed. Start with a template.</>,
          <>If you were typing when the window closed, your text is kept, an error appears and the template picker opens.</>,
        ]}
      />
      <H>Sending a template</H>
      <Steps
        items={[
          <>Click <Ui>Template</Ui> next to the composer.</>,
          <>Inside the window you get <b>Insert Template</b>, which lists approved <i>General</i> templates. Outside it you get{" "}
            <b>Send an approved template</b>, which lists approved re-engagement and campaign templates.</>,
          <>Search, check the preview (it fills in the patient&apos;s and your name), then click <Ui>Send Template</Ui> or{" "}
            <Ui>Send Re-engagement</Ui>.</>,
        ]}
      />
      <Shot name="chat-template-picker" alt="The template picker on a chat whose window has closed" />
      <Callout tone="warn" title="Opted-out patients">
        Marketing templates are marked <b>Marketing</b> in the picker. If the patient opted out, you&apos;re asked to confirm (
        <Ui>They asked for it. Send</Ui>), and the send is recorded in the audit log. See <DocLink to="opt-outs">Opt-outs</DocLink>.
      </Callout>
      <P>
        No approved template? Ask whoever manages templates to create and submit one. See <DocLink to="templates">WhatsApp templates</DocLink>.
      </P>
    </>
  ),
};

const ownership: DocPage = {
  key: "ownership",
  label: "Assigning & status",
  group: GROUP,
  icon: UserCheck,
  description: "Who owns a chat, Open / Pending / Resolved, and handing over",
  keywords: "assign assignee claim owner status open pending resolved hand over shift end",
  visible: inboxUser,
  body: (ctx) => (
    <>
      <Lead>Every chat has at most one owner. Owning a chat means the patient is waiting on you.</Lead>
      <H>Taking and assigning chats</H>
      <Bullets
        items={[
          <><b>Replying claims the chat.</b> Send a message, file or template in an unassigned chat and it becomes yours. If two people
            reply at once, the first one wins.</>,
          ctx.can("conversation:assign")
            ? <>The assignee button in the header (your name, or <b>Unassigned</b>) lets you <Ui>Assign to me</Ui>, pick a teammate (a dot
                shows whether they&apos;re online, on break or offline), or <Ui>Unassign</Ui>.</>
            : <>Your role can&apos;t reassign chats. The header shows who owns it.</>,
          <>If a colleague changed the owner a moment before you, you&apos;re told who has it now. Nothing is overwritten.</>,
        ]}
      />
      <H>Chat status</H>
      <Table
        head={["Status", "Use it when"]}
        rows={[
          [<Ui key="o">Open</Ui>, "You're working on it."],
          [<Ui key="p">Pending</Ui>, "You're waiting on something, such as a call-back or the patient checking their calendar."],
          [<Ui key="r">Resolved</Ui>, "It's done. It leaves Mine, Unassigned and Campaign replies, and the waiting timer stops."],
        ]}
      />
      <Callout tone="note">
        If the patient writes again in a <b>Resolved</b> chat, it reopens as <b>Open</b> automatically. Any follow-up is cancelled as
        soon as the patient writes again. See <DocLink to="outcomes">Follow-ups</DocLink>.
      </Callout>
      <H>End of shift: hand over your chats</H>
      <Steps
        items={[
          <>Click your status at the bottom of the inbox list, then <Ui>Hand over my chats…</Ui>.</>,
          <>Choose <Ui>Back to the queue</Ui> (your chats become Unassigned) or a colleague.</>,
          <>Click <Ui>Hand over</Ui>. Only your open chats move; resolved ones stay with you.</>,
        ]}
      />
      <Shot name="agent-status-menu" alt="The status menu with Hand over my chats" />
      {ctx.can("team:supervise") && (
        <P>Supervisors can also hand over someone else&apos;s work from the Supervision page. See <DocLink to="supervision">Supervision</DocLink>.</P>
      )}
    </>
  ),
};

const outcomes: DocPage = {
  key: "outcomes",
  label: "Follow-ups",
  group: GROUP,
  icon: CalendarClock,
  description: "Set a follow-up, get reminded, cancel it",
  keywords: "follow up follow-up reminder due overdue cancel change outcome",
  visible: inboxUser,
  body: () => (
    <>
      <Lead>
        A follow-up is a reminder to get back to a patient at a set time. Set one whenever you&apos;re waiting on the patient, such as
        when they need to check their calendar or said they&apos;ll call back.
      </Lead>
      <Shot name="chat-outcome-menu" alt="The Follow up menu in the chat header" />
      <H>Setting a follow-up</H>
      <Steps
        items={[
          <>In the chat header, click the <Ui>Follow up</Ui> chip and choose <Ui>Follow up…</Ui>.</>,
          <>Pick <Ui>In 1 hour</Ui>, <Ui>Tomorrow 10:00</Ui> (the default), <Ui>In 3 days</Ui>, or any date and time in{" "}
            <Ui>Follow up on</Ui>.</>,
          <>Click <Ui>Set follow-up</Ui>. The chip shows the date from then on.</>,
        ]}
      />
      <H>What happens next</H>
      <Bullets
        items={[
          <>The chat appears in the inbox&apos;s <Ui>Follow-ups</Ui> tab, soonest first, and its chip turns red once it&apos;s due.</>,
          <>When it&apos;s due, you get one reminder card: &ldquo;Follow up now · patient&rdquo;. It goes to the chat&apos;s owner, or
            to whoever set it, or to everyone on the line. Reminders are checked every 5 minutes.</>,
          <><b>The patient writes again?</b> The follow-up is cancelled automatically: they&apos;re back in touch, so the chat is
            simply waiting for a reply again.</>,
        ]}
      />
      <H>Changing or cancelling it</H>
      <P>
        Click the chip again: <Ui>Change follow-up…</Ui> picks a new time, and <Ui>Cancel follow-up</Ui> removes it.
      </P>
      <P>The same menu also has <Ui>Opt out of marketing…</Ui>. See <DocLink to="opt-outs">Opt-outs</DocLink>.</P>
    </>
  ),
};

const contactPanel: DocPage = {
  key: "contact-panel",
  label: "Contact panel & notes",
  group: GROUP,
  icon: Contact,
  description: "Patient details, notes, tags and shared media",
  keywords: "contact info panel notes internal tags media docs links search chat",
  visible: inboxUser,
  body: () => (
    <>
      <Lead>Click the patient&apos;s name in the chat header (or the panel button on the right) to open the contact panel.</Lead>
      <Shot name="chat-contact-panel" alt="The contact panel beside a chat" />
      <Table
        head={["Section", "What's in it"]}
        rows={[
          ["Identity", "Name, email, chart number and nationality, editable in place. Copy the number. Search this chat. Open the full contact."],
          ["Follow-up", "The follow-up (when it's due and who set it) and the waiting timer."],
          ["Patient notes", "Long-term notes stored on the contact."],
          ["Chat notes", "Staff-only notes on this chat (up to 2000 characters). Never sent to the patient."],
          ["Tags", "Labels used for filtering and segments."],
          ["Media, links and docs", "Everything shared in the chat. Click one to jump to its message."],
          ["Campaigns received", "Which campaigns reached this patient."],
        ]}
      />
      <Callout tone="tip">
        Add a chat note with <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>. You can delete your own notes; supervisors can delete anyone&apos;s.
      </Callout>
    </>
  ),
};

const optOuts: DocPage = {
  key: "opt-outs",
  label: "Opt-outs",
  group: GROUP,
  icon: Ban,
  description: "STOP, do-not-contact and what you may still send",
  keywords: "opt out stop unsubscribe start marketing do not contact lift",
  visible: (ctx) => ctx.can("conversation:write") || ctx.can("contact:write"),
  body: (ctx) => (
    <>
      <Lead>A patient who opted out doesn&apos;t receive campaigns or marketing templates. You can still reply to their messages.</Lead>
      <Shot name="chat-opted-out" alt="A chat with the opt-out banner" />
      <H>How a patient opts out or back in</H>
      <Table
        head={["Patient sends (the whole message, “please” / “من فضلك” allowed)", "Effect"]}
        rows={[
          [<b key="s">STOP, UNSUBSCRIBE, Stop promotions · توقف، إيقاف، إلغاء الاشتراك، لا أريد رسائل</b>, "Opted out of marketing on this line. They get a short confirmation in their language."],
          [<b key="a">STOPALL, STOP ALL · أوقف الكل، إيقاف الكل</b>, "Opted out of marketing on every line."],
          [<b key="t">START, SUBSCRIBE, RESUME · اشتراك، ابدأ، تفعيل</b>, "Lifts only the opt-outs they made themselves (on this line, and a STOP ALL), and confirms it."],
          ["WhatsApp's own “Stop promotions”", "Honoured like STOP — straight away, or at the latest on the next send (error 131050)."],
          [<b key="c">Cancel · إلغاء (alone)</b>, "Not an opt-out — at a clinic it usually means an appointment."],
        ]}
      />
      <Callout tone="note">CANCEL, END and QUIT are deliberately <b>not</b> opt-out words. Patients use them in everyday messages.</Callout>
      <H>Recording an opt-out yourself</H>
      <Steps
        items={[
          <>Click the <Ui>Follow up</Ui> chip in the chat header and choose <Ui>Opt out of marketing…</Ui>.</>,
          <>Pick <Ui>This line only</Ui> or <Ui>All lines (do not contact)</Ui>, and add a reason if you like.</>,
          <>Click <Ui>Opt out</Ui>. A banner on the chat shows the opt-out from then on.</>,
        ]}
      />
      <P>
        Opt-outs are remembered <b>by phone number</b>. A deleted contact who comes back (re-imported, or writing in again) is still
        opted out.
      </P>
      {ctx.can("optout:lift") ? (
        <Callout tone="warn" title="Lifting an opt-out (admins)">
          Use <Ui>Lift opt-out…</Ui> in the same menu, or the Marketing toggle on the contact. If the patient opted out themselves, the
          button reads <Ui>Lift anyway</Ui>. Only do it when the patient clearly asked.
        </Callout>
      ) : (
        <P>Only an admin can lift an opt-out.</P>
      )}
    </>
  ),
};

const alerts: DocPage = {
  key: "alerts",
  label: "Hand-off alerts",
  group: GROUP,
  icon: Bell,
  description: "The alert cards: hand-offs and follow-ups",
  keywords: "notification alert card chime desktop handoff flow follow-up",
  visible: inboxUser,
  body: () => (
    <>
      <Lead>
        When a campaign flow needs a person, or something needs your attention, a card appears in
        the bottom-right corner with a chime. Up to five are shown at a time, and they stay until you dismiss them.
      </Lead>
      <Table
        head={["Card", "Means"]}
        rows={[
          [<b key="1">“Name wants to talk to an agent”</b>, "A flow handed the patient over."],
          [<b key="5">“Follow up now · Name”</b>, "A follow-up you set is due."],
        ]}
      />
      <P>
        An assigned chat&apos;s alerts go only to its owner. Unassigned ones say <b>Waiting in Unassigned</b>. Alerts from another line
        offer <Ui>Switch line & open chat</Ui>. Click <Ui>Enable desktop alerts</Ui> to get them even when the tab is in the background.
      </P>
    </>
  ),
};

export const inboxPages: DocPage[] = [inbox, chatting, windowPage, ownership, outcomes, contactPanel, optOuts, alerts];
