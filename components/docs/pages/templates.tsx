import { Images, LayoutTemplate } from "lucide-react";
import { rolesWith, type DocPage } from "../model";
import { Bullets, Callout, Code, H, Lead, P, Shot, Steps, Table, Ui, Who } from "../primitives";

const GROUP = "Templates & media";

const templates: DocPage = {
  key: "templates",
  label: "WhatsApp templates",
  group: GROUP,
  icon: LayoutTemplate,
  description: "Create templates and get them approved by Meta",
  keywords: "template meta approval submit rejected category general re-engagement campaign carousel placeholder button header footer",
  visible: (ctx) => ctx.can("template:write"),
  body: () => (
    <>
      <Who roles={rolesWith("template:write")} />
      <Lead>
        A template is a message Meta has approved in advance. Templates are the only way to message a patient outside the 24-hour
        window, and every campaign uses one. Templates belong to a WhatsApp Business Account, so lines on the same account share them.
      </Lead>
      <Shot name="templates" alt="The Templates page" />
      <H>Creating a template</H>
      <Shot name="template-editor" alt="The template editor with a live preview" />
      <Steps
        items={[
          <>Click <Ui>New Template</Ui> and enter a <Ui>Template Name</Ui>.</>,
          <>Pick a <b>Category</b> (see the table below) and the language: English or Arabic.</>,
          <>Choose <b>Standard message</b> or <b>Carousel</b> (text plus 2–10 swipeable cards).</>,
          <>Optionally add a <b>Header</b>: Text (up to 60 characters), Image, Video or Document. For media headers, pick a file from the{" "}
            <Ui>Library</Ui>; Meta accepts JPEG or PNG images only.</>,
          <>Write the <b>Body</b> (up to 800 characters). Use <Ui>Personalize ▾</Ui> or type <Code>{"{{"}</Code> to insert{" "}
            <Code>{"{{first_name}}"}</Code>, <Code>{"{{customer_name}}"}</Code> or <Code>{"{{agent_name}}"}</Code>.</>,
          <>Optionally add a <b>Footer</b> (up to 60 characters). Tick <Ui>Add opt-out notice to footer</Ui> for &ldquo;Reply STOP to opt out&rdquo;.</>,
          <>Optionally add up to 10 <b>Buttons</b>, mixed freely: Quick Replies (up to 10), links (2), a call button (1) and a <b>Copy code</b> button (1, Campaign and Re-engagement only) that copies an offer code. Quick Replies stay together; use the arrows to reorder. With more than 3, WhatsApp shows 2 and puts the rest under &ldquo;See all options&rdquo;. A link can end with the patient&apos;s name, filled in for each patient.</>,
          <>Click <Ui>Create Template</Ui>. It&apos;s saved as a <b>Draft</b>. Click <Ui>Submit</Ui> to send it to Meta.</>,
        ]}
      />
      <H>Categories</H>
      <Table
        head={["Category", "Meta bills it as", "Used for"]}
        rows={[
          ["General", "Utility", "Reminders and service messages, inserted inside the 24-hour window. Can't be a carousel."],
          ["Re-engagement", "Marketing", "Restarting a conversation after the window closed"],
          ["Campaign", "Marketing", "Campaigns. Only this category appears in the campaign wizard."],
        ]}
      />
      <H>Approval</H>
      <Bullets
        items={[
          <>Meta usually decides within 24–48 hours. A submitted or approved template can&apos;t be edited.</>,
          <>Decisions arrive instantly (with a backup check every 5 minutes). Click <Ui>Sync Status</Ui> to check now. You get a toast
            when one is approved or rejected, and the sidebar badge counts decisions since your last visit.</>,
          <>A rejected template shows Meta&apos;s reason. Fix it, then <Ui>Resubmit</Ui>.</>,
        ]}
      />
      <Callout tone="warn">
        A template can&apos;t be deleted while any campaign uses it, even a draft. Deleting a submitted template also deletes it at Meta,
        and Meta keeps the name reserved for 30 days.
      </Callout>
    </>
  ),
};

const media: DocPage = {
  key: "media",
  label: "Media library",
  group: GROUP,
  icon: Images,
  description: "Files to reuse in template headers",
  keywords: "media library upload image video document pdf header",
  visible: (ctx) => ctx.can("media:write"),
  body: () => (
    <>
      <Who roles={rolesWith("media:write")} />
      <Lead>The media library stores images, videos and documents to reuse: template headers, flow messages and cards, and campaign images.</Lead>
      <Shot name="media-library" alt="The Media Library" />
      <Bullets
        items={[
          <><Ui>Upload Media</Ui>: images (JPEG, PNG, GIF, WebP), video (MP4, 3GPP), audio (AAC, MP3, OGG, Opus, AMR) and documents
            (PDF, Word, Excel), up to <b>16 MB</b>.</>,
          <>Wherever you choose a file (templates, flows, campaigns), you can also <b>drag it in</b>, <b>paste</b> a copied image (Ctrl+V), or paste a <b>link to an image on any website</b> and click <Ui>Import</Ui>. Every file added this way is saved here too. Imported links are copied, so they keep working if the other site changes.</>,
          <>Filter by type, rename a file, <Ui>Copy URL</Ui>, or open its details (type, size, dimensions, upload date).</>,
          <>Deleting a file that templates use shows how many. Those templates keep showing it until they&apos;re edited.</>,
        ]}
      />
      <Callout tone="tip">For template image headers, use <b>JPEG or PNG</b>. Meta rejects other image formats in headers.</Callout>
      <P>Files you attach in a chat are uploaded separately. They don&apos;t go into the library.</P>
    </>
  ),
};

export const templatePages: DocPage[] = [templates, media];
