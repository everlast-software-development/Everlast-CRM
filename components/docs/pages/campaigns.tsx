import { BarChart3, CheckCheck, GitBranch, Megaphone, ShieldCheck, Wand2 } from "lucide-react";
import { rolesWith, type DocPage } from "../model";
import { Bullets, Callout, Code, DocLink, H, Lead, P, Shot, Steps, Table, Ui, Who } from "../primitives";

const GROUP = "Campaigns";

const overview: DocPage = {
  key: "campaigns",
  label: "Campaigns",
  group: GROUP,
  icon: Megaphone,
  description: "What a campaign is and how it moves from draft to sent",
  keywords: "campaign list status draft awaiting approval sending paused scheduled sent low engagement",
  visible: (ctx) => ctx.can("campaign:read"),
  body: (ctx) => (
    <>
      <Who roles={rolesWith("campaign:read")} />
      <Lead>
        A campaign sends one approved WhatsApp template to an audience on the current line. Patients who reply land in the inbox, and
        an optional <DocLink to="flows">flow</DocLink> can answer their button taps automatically.
      </Lead>
      <Shot
        name={ctx.role === "MARKETING" ? "marketing-campaigns" : "campaigns"}
        alt="The Campaigns page"
        caption={ctx.can("campaign:send") ? "As an admin you approve or reject campaigns right on this page." : "Campaigns you submit wait here for an admin."}
      />
      <H>The life of a campaign</H>
      <Steps
        items={[
          <><b>Draft</b>: being built. Only drafts can be edited.</>,
          <><b>Awaiting approval</b>: submitted by someone who can't send; recipients and flow are now frozen. An admin or marketing approves or rejects it. A
            rejected campaign goes back to drafts marked <b>Sent back</b>, with the reason.</>,
          <><b>Scheduled</b>: approved for a later time. <b>Sending now</b>: messages are going out, with live progress.</>,
          <><b>Paused</b>: stopped by a person or by a safety rule (see <DocLink to="campaign-rules">Sending rules</DocLink>).</>,
          <><b>Completed</b> or <b>Cancelled</b>.</>,
        ]}
      />
      <H>The page, top to bottom</H>
      <Table
        head={["Section", "What you can do"]}
        rows={[
          ["Awaiting approval", ctx.can("campaign:send") ? <><Ui key="a">Approve</Ui> or <Ui key="r">Reject</Ui>.</> : "See what's waiting for an admin."],
          ["Sending now", ctx.can("campaign:control") ? <>Watch progress. <Ui key="p">Pause</Ui> or <Ui key="c">Cancel</Ui>.</> : "Watch progress."],
          ["Paused", <>The reason is shown (Quiet hours, Slowed down, Connection lost, Template unavailable, Quality dropped…).{ctx.can("campaign:control") && <> <Ui key="r">Resume</Ui> or <Ui key="c">Cancel</Ui>.</>}</>],
          ["Scheduled", "When it will send, and to how many."],
          ["Drafts", ctx.can("campaign:write") ? <><Ui key="c">Continue editing</Ui>, or <Ui key="s">Submit</Ui> it.</> : "Campaigns being built."],
          ["Sent", <>Sent, delivered, read, replied and failed per campaign. <b key="l">Low engagement</b> flags a reply rate under 10%.</>],
        ]}
      />
      <P>
        Filter by category: Promotion, Seasonal, Event, Health Awareness, Follow-up, Announcement or Other. <Ui>Export</Ui> downloads
        the list.
      </P>
    </>
  ),
};

const creating: DocPage = {
  key: "new-campaign",
  label: "Creating a campaign",
  group: GROUP,
  icon: Wand2,
  description: "The three-step wizard: template, recipients, review",
  keywords: "new campaign wizard template recipients audience list segment review schedule test send cost",
  visible: (ctx) => ctx.can("campaign:write"),
  body: (ctx) => (
    <>
      <Who roles={rolesWith("campaign:write")} />
      <Lead>
        Click <Ui>New campaign</Ui>. You can also start one from selected contacts, a list or a segment. <Ui>Save draft</Ui> works at
        every step.
      </Lead>
      <Shot name="campaign-new" alt="Step 1 of the campaign wizard: choose a template" />
      <Steps
        items={[
          <><b>Choose a template.</b> Only <b>approved</b> templates in the <b>Campaign</b> category are listed. Check the live preview,
            then <Ui>Continue → Recipients</Ui>. If the template has an image (or video, or document) header, you can give this
            campaign <b>its own image</b> under the preview, with no new Meta approval. It has to stay the same kind (an image stays an image).</>,
          <><b>Select recipients</b> from the <Ui>Contacts</Ui>, <Ui>Lists</Ui> or <Ui>Segments</Ui> tab. The side panel estimates
            send time and cost, and warns if you&apos;d go over the line&apos;s daily messaging limit. Opted-out contacts are counted
            and skipped automatically. Then <Ui>Review →</Ui>.</>,
          <><b>Review.</b> Name the campaign and <b>pick a category</b> (required). Optionally attach a flow. Then choose when to send:
            {ctx.can("campaign:send")
              ? <> <Ui>Send now</Ui> or <Ui>Schedule for later</Ui>.</>
              : <> <Ui>As soon as approved</Ui> or <Ui>Propose a time</Ui>. If it&apos;s approved after that time, it sends straight away.</>}
          </>,
          <><b>Test first</b> (recommended): send the template to a staff test number with <Ui>Test</Ui>. Nothing is recorded against
            the campaign.</>,
          ctx.can("campaign:send")
            ? <>Click <Ui>Send now</Ui> or <Ui>Schedule for …</Ui>.</>
            : <>Click <Ui>Submit for approval</Ui>. An admin reviews it before anything goes out, and you can&apos;t edit it while it waits.</>,
        ]}
      />
      <Callout tone="note" title="Test sends">
        Test messages only go to the staff test numbers an admin set in Settings → Campaign safety. The limit is 10 tests per hour.
        {!ctx.can("campaign:send") && " Tests can't be sent during quiet hours."}
      </Callout>
      <Callout tone="warn">
        A segment is re-run and <b>frozen</b> when the campaign is created. Anyone who qualifies later isn&apos;t added to this campaign.
      </Callout>
    </>
  ),
};

const approval: DocPage = {
  key: "approval",
  label: "Approval & sending",
  group: GROUP,
  icon: CheckCheck,
  description: "Who approves, the daily messaging limit and scheduling",
  keywords: "approve reject approval submit messaging limit tier send anyway schedule",
  visible: (ctx) => ctx.can("campaign:read"),
  body: (ctx) => (
    <>
      <Lead>
        Admins and marketing <b>send or schedule</b> campaigns directly. A campaign drafted by someone without that right is submitted
        for approval instead, and an admin or marketing approves or rejects it.
      </Lead>
      {ctx.can("campaign:send") ? (
        <>
          <Shot name="campaign-approve" alt="The approve campaign dialog" />
          <H>Approving</H>
          <Steps
            items={[
              <>On <b>Campaigns → Awaiting approval</b> (the sidebar badge counts them), click <Ui>Approve</Ui>.</>,
              <>The dialog says whether it starts sending right away or at the time the submitter proposed. A proposed time that has
                already passed sends immediately.</>,
              <>Check the daily-limit line: <b>Needs N · M left today (limit L per 24 hours)</b>.</>,
              <>Click <Ui>Approve & send</Ui> or <Ui>Approve & schedule</Ui>.</>,
            ]}
          />
          <H>Rejecting</H>
          <P>
            Click <Ui>Reject</Ui> and give a reason, for example &ldquo;Wrong audience — exclude patients seen this month.&rdquo; The
            campaign goes back to the submitter&apos;s drafts with your reason.
          </P>
        </>
      ) : (
        <>
          <H>After you submit</H>
          <Bullets
            items={[
              <>The campaign waits under <b>Awaiting approval</b> with <b>Waiting for an admin</b>.</>,
              <>If it&apos;s approved, it sends right away or at your proposed time.</>,
              <>If it&apos;s rejected, it comes back to <b>Drafts</b> marked <b>Sent back</b>, with the admin&apos;s reason. Click{" "}
                <Ui>Edit & resubmit</Ui>.</>,
            ]}
          />
        </>
      )}
      <H>The daily messaging limit</H>
      <P>
        Meta limits how many different people a line can start conversations with in any 24 hours: 250, 1K, 2K, 10K, 100K or unlimited.
        See the line&apos;s tier on {ctx.can("stats:read") ? <DocLink to="number-health">Number Health</DocLink> : "Number Health"}.
      </P>
      <Callout tone="warn">
        Over the limit, you&apos;re asked to confirm (<Ui>Send anyway</Ui> / <Ui>Approve anyway</Ui>). Messages past the limit fail and
        the campaign pauses until the window frees up. Split big audiences across days.
      </Callout>
    </>
  ),
};

const results: DocPage = {
  key: "campaign-results",
  label: "Results & replies",
  group: GROUP,
  icon: BarChart3,
  description: "Delivery, reads, replies and the recipients table",
  keywords: "results stats delivered read replied failed skipped recipients replies attribution",
  visible: (ctx) => ctx.can("campaign:read"),
  body: (ctx) => (
    <>
      <Lead>Open a campaign to see what it achieved.</Lead>
      <Shot name="campaign-detail" alt="A completed campaign's results" />
      <Table
        head={["Card", "Counts"]}
        rows={[
          ["Total sent", "Messages Meta accepted"],
          ["Delivered / Read", "Reached the phone / opened"],
          ["Replied", "Patients who answered it (see below)"],
          ["Failed", "Messages Meta refused. The reason is in the recipients table."],
        ]}
      />
      <H>What counts as a reply</H>
      <P>
        A patient&apos;s message counts as a reply to the campaign if they quoted it or tapped one of its buttons, or if they wrote
        within <b>7 days</b> of receiving it. The <b>Replies</b> panel lists who still needs an answer
        {ctx.can("conversation:write") ? <>, each with <Ui>Open chat</Ui></> : ""}.
      </P>
      <H>The recipients table</H>
      <P>
        One row per patient, with status <b>Pending</b>, <b>Sending</b>, <b>Sent</b>, <b>Failed</b> or <b>Skipped</b>, and the reason
        in the Error column. Common skips:
      </P>
      <Bullets
        items={[
          <><b>Opted out</b>: the patient opted out before it was sent.</>,
          <><b>Got &ldquo;X&rdquo; on date — limit is one campaign every N day(s)</b>: the frequency cap. See{" "}
            <DocLink to="campaign-rules">Sending rules</DocLink>.</>,
        ]}
      />
      <P>
        A flow attached to a campaign can only be changed while the campaign is a draft. The flow card links to its responses.
      </P>
    </>
  ),
};

const rules: DocPage = {
  key: "campaign-rules",
  label: "Sending rules",
  group: GROUP,
  icon: ShieldCheck,
  description: "Quiet hours, frequency cap, quality, opt-outs and pauses",
  keywords: "quiet hours frequency cap quality auto pause opt out rate limit resume template paused",
  visible: (ctx) => ctx.can("campaign:read"),
  body: (ctx) => (
    <>
      <Lead>Several automatic rules protect patients and the clinic&apos;s WhatsApp lines. They apply to every campaign.</Lead>
      <Table
        head={["Rule", "What it does"]}
        rows={[
          ["Quiet hours", "No campaign messages from 21:00 to 09:00 (Dubai) by default. A campaign that reaches quiet hours pauses and resumes by itself. A schedule inside quiet hours is refused, with the earliest allowed time. Inbox replies aren't affected."],
          ["Frequency cap", "At most one campaign per patient every N days (0 = off, up to 90). Patients over the cap are Skipped, with the reason."],
          ["Quality auto-pause", "Meta rates each line GREEN, YELLOW or RED. When it drops (at YELLOW by default), running campaigns on that line pause and new ones can't start. Checked every 30 minutes."],
          ["Opt-outs", "Opted-out patients are always skipped."],
          ["Template checks", "Before sending and resuming: the template must still be approved by Meta, not paused or disabled, and on the same WhatsApp account."],
        ]}
      />
      <H>Why a campaign paused, and who resumes it</H>
      <Table
        head={["Paused because", "Resumes"]}
        rows={[
          ["Quiet hours", "Automatically, when quiet hours end"],
          ["Slowed down (Meta rate limit)", "Automatically, after about 2 minutes"],
          ["Connection lost", "Automatically, after about 5 minutes"],
          ["Paused by a person", "When someone clicks Resume"],
          ["Quality dropped", "When someone clicks Resume (the rating is checked again first)"],
          ["Template unavailable / line switched off / send error", "When someone fixes the cause and clicks Resume"],
        ]}
      />
      <Callout tone="tip">
        Campaign sending survives restarts. If the server restarts mid-send, the campaign carries on where it stopped, and nobody gets
        it twice.
      </Callout>
      {ctx.can("settings:write") && (
        <P>
          Admins set quiet hours, the frequency cap, the quality threshold and test numbers in{" "}
          <DocLink to="workspace-settings">Settings → Quiet hours & Campaign safety</DocLink>.
        </P>
      )}
    </>
  ),
};

const flows: DocPage = {
  key: "flows",
  label: "Flows",
  group: GROUP,
  icon: GitBranch,
  description: "Automations that answer a campaign's buttons",
  keywords: "flow automation builder steps message list question hand to agent simulator responses",
  visible: (ctx) => ctx.can("campaign:read"),
  body: (ctx) => (
    <>
      <Who roles={rolesWith("campaign:write")} />
      <Lead>
        A <b>flow</b> answers patients who tap a campaign&apos;s buttons. It can send information, ask questions, tag the patient and
        hand them to the team. Open <b>Flows</b> in the sidebar.
      </Lead>
      <Shot name="flows" alt="The Flows list" />
      <H>Building a flow</H>
      <Shot name="flow-builder" alt="The flow builder" />
      {ctx.can("campaign:write") ? (
        <Steps
          items={[
            <>Click <Ui>New flow</Ui>. Give it a name (e.g. &ldquo;Laser offer — October&rdquo;) and switch it <b>On</b>.</>,
            <>On the <b>Start</b> step, <Ui>Copy buttons from a template</Ui>. Each button becomes an output; an &ldquo;any reply&rdquo; output is also available.</>,
            <>Select a step and pick the next one from <b>Add a step</b>. It connects to the first free output. To connect by hand, drag
              from an output dot. To remove a line, select it and press Delete.</>,
            <>Click <Ui>Test</Ui> for a dry run (nothing is sent or saved), then <Ui>Save flow</Ui>.</>,
            <>Attach it to a campaign in the wizard&apos;s review step.</>,
          ]}
        />
      ) : (
        <P>Your role can view flows and their responses but not edit them.</P>
      )}
      <H>Step types</H>
      <Table
        head={["Step", "Does"]}
        rows={[
          ["Message", "Text with optional image/video/PDF and up to 3 buttons"],
          ["List", "A menu of up to 10 options"],
          ["Product cards", "2–10 swipeable cards (free inside the chat window)"],
          ["Carousel template", "An approved carousel template (paid per send)"],
          ["Question", "Asks something and saves the answer (text, date, number, phone or email); asks again if it doesn't fit"],
          ["Tag", "Adds a tag to the patient"],
          ["Hand to agent", "Assigns the chat to a person (or leaves it Unassigned) and stops the automation"],
          ["End", "An optional closing message, then stop"],
        ]}
      />
      <Callout tone="note" title="Pick appointment is no longer available">
        Older flows may still contain a <b>Pick appointment</b> step. When a patient reaches it, the flow hands them to the team
        instead. The builder marks the step as no longer available; delete it and connect a <b>Hand to agent</b> step in its place.
      </Callout>
      <H>Good to know</H>
      <Bullets
        items={[
          <>Limits: 100 steps per flow; button titles 20 characters; list rows 24. Answer field names use lowercase letters, numbers and{" "}
            <Code>_</Code>. Built-in variables are <Code>first_name</Code>, <Code>customer_name</Code> and <Code>phone</Code>.</>,
          <>A run ends after 24 hours without an answer, when the patient taps the campaign again, or as soon as an agent replies by hand.</>,
          <>A flow used by a campaign that&apos;s waiting, scheduled, running or paused is <b>locked</b> for non-admins. Click{" "}
            <Ui>Duplicate</Ui> to make an editable copy.</>,
          <>The <b>Responses</b> tab shows every run: status (In progress, Completed, Handed to agent, Stopped, No answer, Failed), the
            path taken and the saved answers.</>,
        ]}
      />
    </>
  ),
};

export const campaignPages: DocPage[] = [overview, creating, approval, results, rules, flows];
