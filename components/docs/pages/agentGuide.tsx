"use client";

import { BookOpen } from "lucide-react";
import type { DocPage } from "../model";
import { Bilingual, Callout, H, Kbd, Lead, P, Steps, Ui, type DocLang as Lang } from "../primitives";
import { AnnotatedShot, type Note, type T } from "../guideKit";

// The agent's quick guide: the screen and the inbox, in English or Arabic.
// Screenshots carry numbered arrows drawn over them, so one image serves both
// languages; the numbered list under each one says the same thing in full.

const INBOX_NOTES: Note[] = [
  {
    x: 16, y: 66, lx: 16.5, ly: 88,
    label: { en: "Conversations appear here", ar: "تظهر المحادثات هنا" },
    more: {
      en: "Every patient who messaged this line, newest first. A green number means unread messages.",
      ar: "كل مريض راسل هذا الرقم، الأحدث أولاً. الرقم الأخضر يعني رسائل غير مقروءة.",
    },
  },
  {
    x: 13, y: 18.5, lx: 33, ly: 3.2,
    label: { en: "Mine · Unassigned", ar: "Mine · Unassigned" },
    more: {
      en: "Mine shows your chats. Unassigned shows patients nobody has taken yet — start there when you're free.",
      ar: "تبويب Mine يعرض محادثاتك، وتبويب Unassigned يعرض مرضى لم يستلمهم أحد بعد — ابدأ منه عندما تكون متاحاً.",
    },
  },
  {
    x: 37, y: 57.5, lx: 41, ly: 68,
    label: { en: "Patient's messages", ar: "رسائل المريض" },
    more: {
      en: "The patient's messages are here, on the left, in white.",
      ar: "رسائل المريض تظهر هنا على اليسار باللون الأبيض.",
    },
  },
  {
    x: 85, y: 52.5, lx: 82, ly: 64,
    label: { en: "Your replies", ar: "ردودك" },
    more: {
      en: "Your team's replies are on the right, in green, with the sender's name above.",
      ar: "ردود الفريق تظهر على اليمين باللون الأخضر، واسم المرسل فوقها.",
    },
  },
  {
    x: 52, y: 95.5, lx: 52, ly: 84,
    label: { en: "Type your reply here", ar: "اكتب ردك هنا" },
    more: {
      en: "Write your message, then press Send or Enter. Shift + Enter starts a new line.",
      ar: "اكتب رسالتك ثم اضغط Send أو Enter. للانتقال إلى سطر جديد اضغط Shift + Enter.",
    },
  },
  {
    x: 41, y: 9.5, lx: 52, ly: 14,
    label: { en: "Patient details", ar: "بيانات المريض" },
    more: {
      en: "Click the patient's name to see their details, notes and earlier chats.",
      ar: "اضغط على اسم المريض لعرض بياناته وملاحظاته ومحادثاته السابقة.",
    },
  },
  {
    x: 92, y: 9.5, lx: 80, ly: 19,
    label: { en: "Who owns the chat", ar: "صاحب المحادثة" },
    more: {
      en: "The person this chat belongs to. When you reply to an unassigned chat, it becomes yours.",
      ar: "الموظف المسؤول عن المحادثة. عندما ترد على محادثة غير مُسندة تصبح محادثتك.",
    },
  },
  {
    x: 84, y: 3, lx: 64, ly: 3.2,
    label: { en: "Your WhatsApp line", ar: "رقم واتساب" },
    more: {
      en: "The WhatsApp number you're answering on. Chats on another number are under that number.",
      ar: "رقم واتساب الذي ترد منه. محادثات الأرقام الأخرى تظهر عند اختيار ذلك الرقم.",
    },
  },
];

const SAVED_NOTES: Note[] = [
  {
    x: 50, y: 71, lx: 58, ly: 59,
    label: { en: "Saved replies", ar: "الردود الجاهزة" },
    more: {
      en: "Type / in the message box to see them. Use ↑ ↓ to choose and Enter to insert, or keep typing to search.",
      ar: "اكتب / في خانة الرسالة لتظهر. استخدم ↑ ↓ للاختيار ثم Enter للإضافة، أو تابع الكتابة للبحث.",
    },
  },
  {
    x: 81, y: 96, lx: 92, ly: 82,
    label: { en: "Or click here", ar: "أو اضغط هنا" },
    more: {
      en: "The same list, for when you don't remember a shortcut.",
      ar: "نفس القائمة، إذا لم تتذكر الاختصار.",
    },
  },
];

const CLOSED_NOTES: Note[] = [
  {
    x: 12.5, y: 75.5, lx: 15, ly: 88,
    label: { en: "Window closed", ar: "Window closed" },
    more: {
      en: "The patient's last message was more than 24 hours ago.",
      ar: "آخر رسالة من المريض كانت قبل أكثر من 24 ساعة.",
    },
  },
  {
    x: 42, y: 96, lx: 44, ly: 80,
    label: { en: "Can't type a message", ar: "لا يمكن كتابة رسالة" },
    more: {
      en: "WhatsApp doesn't allow normal messages after 24 hours.",
      ar: "واتساب لا يسمح بالرسائل العادية بعد مرور 24 ساعة.",
    },
  },
  {
    x: 89, y: 96.5, lx: 82, ly: 80,
    label: { en: "Send a Template", ar: "أرسل Template" },
    more: {
      en: "Pick an approved template to restart the chat. When the patient replies, you can write normally again.",
      ar: "اختر قالباً معتمداً لإعادة فتح المحادثة. عندما يرد المريض يمكنك الكتابة بشكل عادي مرة أخرى.",
    },
  },
];

const TEXT = {
  lead: {
    en: "Everything you need to answer patients on WhatsApp: where the chats are, where the messages are, and how to reply.",
    ar: "كل ما تحتاجه للرد على المرضى عبر واتساب: أين تجد المحادثات، وأين تظهر الرسائل، وكيف ترد.",
  },
  screen: { en: "The screen", ar: "الشاشة" },
  answer: { en: "Answering a patient", ar: "الرد على مريض" },
  steps: [
    { en: "Open the Unassigned tab (patients waiting for someone) or Mine (your chats).", ar: "افتح تبويب Unassigned (مرضى ينتظرون الرد) أو Mine (محادثاتك)." },
    { en: "Click a chat. Its messages open on the right.", ar: "اضغط على المحادثة، فتظهر رسائلها على اليمين." },
    { en: "Type your reply and press Send. Replying to an unassigned chat makes it yours.", ar: "اكتب ردك واضغط Send. عندما ترد على محادثة غير مُسندة تصبح محادثتك." },
  ],
  waiting: {
    en: "The timer under a chat shows how long the patient has been waiting for a reply: grey, then amber after 15 minutes, red after 30.",
    ar: "المؤقت تحت المحادثة يوضح مدة انتظار المريض للرد: رمادي، ثم برتقالي بعد 15 دقيقة، ثم أحمر بعد 30 دقيقة.",
  },
  waitingTitle: { en: "Waiting timer", ar: "مؤقت الانتظار" },
  saved: { en: "Saved replies", ar: "الردود الجاهزة" },
  savedText: {
    en: "Ready-made answers for common questions, like opening hours or prices. The reply goes into the box with the patient's name filled in. Check it, change it if needed, then press Send — nothing is sent by itself.",
    ar: "إجابات جاهزة للأسئلة المتكررة مثل مواعيد العمل أو الأسعار. يُضاف الرد إلى خانة الكتابة مع اسم المريض. راجعه وعدّله إن لزم ثم اضغط Send — لا يُرسل أي شيء تلقائياً.",
  },
  closed: { en: "After 24 hours: the window is closed", ar: "بعد 24 ساعة: انتهاء مهلة المحادثة" },
  closedText: {
    en: "WhatsApp lets you write freely only within 24 hours of the patient's last message. After that, you can only send an approved template.",
    ar: "يسمح واتساب بالكتابة بحرية خلال 24 ساعة فقط من آخر رسالة للمريض. بعد ذلك يمكنك إرسال قالب معتمد فقط.",
  },
  arabicTitle: { en: "Arabic messages", ar: "الرسائل العربية" },
  arabic: {
    en: "Arabic text reads right-to-left by itself, in chats and in the box you type in.",
    ar: "النص العربي يُعرض من اليمين إلى اليسار تلقائياً، في المحادثات وفي خانة الكتابة.",
  },
};

function AgentGuide({ lang }: { lang: Lang }) {
  const t = (x: T) => x[lang];

  return (
    <>
      <Lead>{t(TEXT.lead)}</Lead>

      <H>{t(TEXT.screen)}</H>
      <AnnotatedShot name="guide-inbox" alt="The inbox with a chat open" notes={INBOX_NOTES} lang={lang} />

      <H>{t(TEXT.answer)}</H>
      <Steps items={TEXT.steps.map(t)} />
      <Callout tone="tip" title={t(TEXT.waitingTitle)}>{t(TEXT.waiting)}</Callout>

      <H>{t(TEXT.saved)}</H>
      <P>{t(TEXT.savedText)}</P>
      <AnnotatedShot name="guide-saved-replies" alt="The saved replies list above the message box" notes={SAVED_NOTES} lang={lang} />

      <H>{t(TEXT.closed)}</H>
      <P>{t(TEXT.closedText)}</P>
      <AnnotatedShot name="guide-window-closed" alt="A chat whose 24-hour window has closed" notes={CLOSED_NOTES} lang={lang} />

      <Callout tone="note" title={t(TEXT.arabicTitle)}>{t(TEXT.arabic)}</Callout>
      <P>
        <Kbd>Enter</Kbd> <Ui>Send</Ui> · <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> {lang === "ar" ? "سطر جديد" : "new line"} · <Kbd>/</Kbd>{" "}
        {lang === "ar" ? "الردود الجاهزة" : "saved replies"}
      </P>
    </>
  );
}

const agentGuide: DocPage = {
  key: "agent-guide",
  label: "Agent guide · دليل الموظف",
  group: "Getting started",
  icon: BookOpen,
  description: "The screen and the inbox, in English and Arabic",
  keywords: "agent quick start arabic عربي inbox chats reply saved replies window closed template",
  // The first page for the people who answer chats (agents, supervisors);
  // admins see it by previewing one of those roles.
  visible: (ctx) => ctx.can("conversation:write") && !ctx.can("settings:write"),
  body: () => <Bilingual>{(_t, lang) => <AgentGuide lang={lang} />}</Bilingual>,
};

export const agentGuidePages: DocPage[] = [agentGuide];
