"use client";

import { ShieldCheck } from "lucide-react";
import type { DocPage } from "../model";
import { Bilingual, Callout, DocLink, H, Lead, P, Steps, type DocLang as Lang } from "../primitives";
import { AnnotatedShot, type Note, type T } from "../guideKit";

// The supervisor's quick guide, in English or Arabic: watching the team on
// Supervision, moving chats, and keeping the messages the team sends
// (patient-care templates and saved replies). Answering a chat itself is in
// the agent guide, which supervisors also see.

const SUPERVISION_NOTES: Note[] = [
  {
    x: 13, y: 22.2, lx: 20, ly: 31.6,
    label: { en: "Who's waiting", ar: "من ينتظر" },
    more: {
      en: "Patients waiting for a reply now, how many over 30 minutes, and the longest wait. Red means someone is over 30 minutes.",
      ar: "المرضى الذين ينتظرون الرد الآن، وعدد من تجاوز انتظارهم 30 دقيقة، وأطول مدة انتظار. اللون الأحمر يعني أن أحدهم تجاوز 30 دقيقة.",
    },
  },
  {
    x: 28.5, y: 22.2, lx: 37, ly: 31.6,
    label: { en: "Unread", ar: "غير المقروءة" },
    more: {
      en: "Open chats with patient messages nobody on the team has opened yet, how many messages that is, and how many of those chats have no owner. Click it to list them.",
      ar: "المحادثات المفتوحة التي فيها رسائل من المرضى لم يفتحها أحد من الفريق بعد، وعدد هذه الرسائل، وكم منها بلا موظف مسؤول. اضغط عليها لعرضها.",
    },
  },
  {
    x: 44, y: 22.2, lx: 54, ly: 31.6,
    label: { en: "Answered today", ar: "تم الرد اليوم" },
    more: {
      en: "Patients the team replied to today. Each time a patient writes and someone answers counts once, however many messages the answer took. A patient who wrote last night and got a reply this morning counts today.",
      ar: "عدد المرضى الذين رد عليهم الفريق اليوم. كل مرة يكتب فيها المريض ويرد عليه أحد تُحسب مرة واحدة، مهما كان عدد رسائل الرد. المريض الذي كتب ليلاً وتلقى الرد صباحاً يُحسب اليوم.",
    },
  },
  {
    x: 75, y: 22.2, lx: 75, ly: 31.6,
    label: { en: "Follow-ups due", ar: "المتابعات المستحقة" },
    more: {
      en: "Chats an agent marked for a follow-up that is due now or overdue.",
      ar: "محادثات حدّد لها الموظف موعد متابعة حان وقته أو تأخر.",
    },
  },
  {
    x: 22.7, y: 47, lx: 23, ly: 56,
    label: { en: "Unassigned", ar: "Unassigned" },
    more: {
      en: "Patients nobody has taken yet. Click the card to list only them.",
      ar: "مرضى لم يستلمهم أي موظف بعد. اضغط على البطاقة لعرضهم فقط.",
    },
  },
  {
    x: 38, y: 44.8, lx: 50, ly: 60,
    label: { en: "One card per agent", ar: "بطاقة لكل موظف" },
    more: {
      en: "Online, on break or offline. Top row: open chats, patients waiting on them (\"late\" in red when over 30 minutes) and their unread chats. Bottom row: patients they answered today, messages they sent (Replies) and their average reply time. Click a card to see only their chats.",
      ar: "حالة الموظف (متصل، في استراحة، غير متصل). الصف الأعلى: محادثاته المفتوحة، والمرضى الذين ينتظرون رده (\"late\" باللون الأحمر بعد 30 دقيقة)، ومحادثاته غير المقروءة. الصف الأسفل: المرضى الذين رد عليهم اليوم (Answered)، والرسائل التي أرسلها (Replies)، ومتوسط وقت الرد. اضغط على البطاقة لعرض محادثاته فقط.",
    },
  },
  {
    x: 44.9, y: 36.9, lx: 78, ly: 66,
    label: { en: "Hand over", ar: "تسليم المحادثات" },
    more: {
      en: "Moves all of this person's open chats to a colleague or back to the queue. See \"Handing over someone's chats\" below.",
      ar: "ينقل كل محادثات هذا الموظف المفتوحة إلى زميل أو يعيدها إلى قائمة الانتظار. راجع قسم \"تسليم محادثات موظف\" أدناه.",
    },
  },
  {
    x: 8.3, y: 64.1, lx: 50, ly: 72,
    label: { en: "Chat lists", ar: "قوائم المحادثات" },
    more: {
      en: "Waiting, Unread, Gone cold (waiting over 24 hours), Dropped halfway, Follow up and All chats. A green number on a chat is its unread messages. Click a chat to see it in full on the right.",
      ar: "Waiting، وUnread، وGone cold (انتظار أكثر من 24 ساعة)، وDropped halfway، وFollow up، وAll chats. الرقم الأخضر على المحادثة هو عدد رسائلها غير المقروءة. اضغط على محادثة لعرضها كاملة على اليمين.",
    },
  },
  {
    x: 76.5, y: 10.2, lx: 58, ly: 3.2,
    label: { en: "Live view · Report", ar: "Live view · Report" },
    more: {
      en: "Live view is a full-screen board for a TV in the office. Report opens the reports.",
      ar: "Live view شاشة كاملة لعرضها على تلفاز في المكتب، وReport يفتح التقارير.",
    },
  },
];

const REASSIGN_NOTES: Note[] = [
  {
    x: 41, y: 61.4, lx: 50, ly: 50,
    label: { en: "Who owns the chat", ar: "صاحب المحادثة" },
    more: {
      en: "Click the owner's name to change it.",
      ar: "اضغط على اسم صاحب المحادثة لتغييره.",
    },
  },
  {
    x: 33.7, y: 66.9, lx: 15, ly: 70,
    label: { en: "Assign to me", ar: "Assign to me" },
    more: {
      en: "Take the chat yourself.",
      ar: "استلم المحادثة بنفسك.",
    },
  },
  {
    x: 33.5, y: 78.4, lx: 15, ly: 84,
    label: { en: "Pick a colleague", ar: "اختر زميلاً" },
    more: {
      en: "The chat moves to them at once. The dot shows who is online (green) or on break (amber). Unassign puts it back in the queue.",
      ar: "تنتقل المحادثة إليه فوراً. النقطة توضح من هو متصل (أخضر) أو في استراحة (برتقالي). Unassign يعيدها إلى قائمة الانتظار.",
    },
  },
  {
    x: 49.1, y: 61.4, lx: 64, ly: 67,
    label: { en: "How long they've waited", ar: "مدة الانتظار" },
    more: {
      en: "Grey, then amber after 15 minutes, red after 30.",
      ar: "رمادي، ثم برتقالي بعد 15 دقيقة، ثم أحمر بعد 30 دقيقة.",
    },
  },
  {
    x: 86, y: 61.4, lx: 85, ly: 72,
    label: { en: "Open in inbox · Reply", ar: "Open in inbox · Reply" },
    more: {
      en: "Open the chat in the inbox to read it all or answer the patient yourself.",
      ar: "افتح المحادثة في صندوق الرسائل لقراءتها كاملة أو للرد على المريض بنفسك.",
    },
  },
];

const HANDOVER_NOTES: Note[] = [
  {
    x: 38.4, y: 42.3, lx: 22, ly: 29.6,
    label: { en: "Back to the queue", ar: "Back to the queue" },
    more: {
      en: "Their chats become unassigned, and whoever is free picks them up.",
      ar: "تصبح محادثاته غير مُسندة، ويستلمها أي موظف متاح.",
    },
  },
  {
    x: 38.4, y: 53.7, lx: 18, ly: 57,
    label: { en: "Or one colleague", ar: "أو زميل واحد" },
    more: {
      en: "All the open chats go to that person.",
      ar: "تنتقل كل المحادثات المفتوحة إلى هذا الزميل.",
    },
  },
  {
    x: 59.7, y: 70.4, lx: 78, ly: 72,
    label: { en: "Hand over", ar: "Hand over" },
    more: {
      en: "Moves the chats now. Patients don't see any change.",
      ar: "ينقل المحادثات فوراً، ولا يلاحظ المرضى أي تغيير.",
    },
  },
];

const TEMPLATE_NOTES: Note[] = [
  {
    x: 32, y: 28.3, lx: 12, ly: 38,
    label: { en: "New message", ar: "New message" },
    more: {
      en: "Write a new patient-care message, or start from an example.",
      ar: "اكتب رسالة رعاية جديدة، أو ابدأ من مثال جاهز.",
    },
  },
  {
    x: 31, y: 38.3, lx: 12, ly: 46,
    label: { en: "Ready to use", ar: "Ready to use" },
    more: {
      en: "WhatsApp approved it. Agents can send it from any chat, even after the 24-hour window.",
      ar: "وافق عليها واتساب. يمكن للموظفين إرسالها من أي محادثة، حتى بعد مرور 24 ساعة.",
    },
  },
  {
    x: 33.3, y: 52.5, lx: 12, ly: 54,
    label: { en: "Waiting for WhatsApp", ar: "Waiting for WhatsApp" },
    more: {
      en: "Sent for approval. WhatsApp usually answers within minutes, at most 24 hours. Check for WhatsApp's answer reloads it.",
      ar: "أُرسلت للموافقة. يرد واتساب عادةً خلال دقائق، وبحد أقصى 24 ساعة. زر Check for WhatsApp's answer يحدّث الحالة.",
    },
  },
  {
    x: 45.8, y: 74.5, lx: 12, ly: 70,
    label: { en: "Rejected, with the reason", ar: "مرفوضة مع السبب" },
    more: {
      en: "WhatsApp's reason is shown under the message. Change the wording and press Send again.",
      ar: "يظهر سبب واتساب تحت الرسالة. عدّل الصياغة ثم اضغط Send again.",
    },
  },
  {
    x: 84.2, y: 83.1, lx: 84, ly: 95,
    label: { en: "Send for approval", ar: "Send for approval" },
    more: {
      en: "A draft isn't sent to WhatsApp until you press this. Drafts and rejected messages can still be edited.",
      ar: "لا تُرسل المسودة إلى واتساب حتى تضغط هذا الزر. يمكن تعديل المسودات والرسائل المرفوضة.",
    },
  },
];

const EDITOR_NOTES: Note[] = [
  {
    x: 30, y: 13, lx: 14, ly: 13,
    label: { en: "Start from an example", ar: "ابدأ من مثال" },
    more: {
      en: "Reminders, confirmations, results ready and more, in English and Arabic.",
      ar: "تذكير بالموعد، وتأكيد موعد، وجاهزية النتائج وغيرها، بالعربية والإنجليزية.",
    },
  },
  {
    x: 27.5, y: 38, lx: 14, ly: 34,
    label: { en: "Header", ar: "العنوان" },
    more: {
      en: "Optional: a bold line, a picture (JPG or PNG), a video (MP4) or a PDF above the message.",
      ar: "اختياري: سطر عريض، أو صورة (JPG أو PNG)، أو فيديو (MP4)، أو ملف PDF فوق الرسالة.",
    },
  },
  {
    x: 25, y: 55.4, lx: 14, ly: 50,
    label: { en: "Blanks", ar: "الفراغات" },
    more: {
      en: "Click one to put it where the cursor is. The patient's first name fills in by itself; the agent types the date, time, doctor, branch or details when sending.",
      ar: "اضغط على أحدها لإضافته مكان المؤشر. اسم المريض يُملأ تلقائياً، أما التاريخ والوقت والطبيب والفرع والتفاصيل فيكتبها الموظف عند الإرسال.",
    },
  },
  {
    x: 30, y: 64, lx: 14, ly: 66,
    label: { en: "The message", ar: "نص الرسالة" },
    more: {
      en: "Up to 800 characters. It can't start or end with a blank.",
      ar: "حتى 800 حرف، ولا يمكن أن تبدأ أو تنتهي بفراغ.",
    },
  },
  {
    x: 22, y: 85.4, lx: 14, ly: 82,
    label: { en: "Footer and buttons", ar: "التذييل والأزرار" },
    more: {
      en: "Optional: a small grey line under the message, and up to 2 links, 1 call button and quick replies. Scroll down for the buttons, the box to tick and Send for approval.",
      ar: "اختياري: سطر رمادي صغير تحت الرسالة، وحتى رابطين وزر اتصال واحد وردود سريعة. انزل للأسفل لتجد الأزرار ومربع التأكيد وزر Send for approval.",
    },
  },
  {
    x: 74, y: 30, lx: 90, ly: 46,
    label: { en: "Preview", ar: "المعاينة" },
    more: {
      en: "What the patient sees, with example values in the blanks, the buttons included.",
      ar: "ما سيراه المريض، مع قيم توضيحية في الفراغات، والأزرار أيضاً.",
    },
  },
];

const SAVED_NOTES: Note[] = [
  {
    x: 45, y: 19, lx: 45, ly: 3.2,
    label: { en: "{name}", ar: "{name}" },
    more: {
      en: "Write {name} where the patient's first name should go.",
      ar: "اكتب {name} في المكان الذي تريد أن يظهر فيه اسم المريض الأول.",
    },
  },
  {
    x: 28.4, y: 33.2, lx: 12, ly: 40,
    label: { en: "The shortcut", ar: "الاختصار" },
    more: {
      en: "What agents type after / to find it. Lowercase, no spaces.",
      ar: "ما يكتبه الموظف بعد / للعثور على الرد. أحرف صغيرة وبدون مسافات.",
    },
  },
  {
    x: 91.2, y: 33.3, lx: 72, ly: 62,
    label: { en: "Edit · Delete", ar: "تعديل · حذف" },
    more: {
      en: "Changes apply from the next time an agent inserts it. Messages already sent aren't affected.",
      ar: "تسري التعديلات من المرة القادمة التي يستخدم فيها الموظف الرد. الرسائل المرسلة سابقاً لا تتأثر.",
    },
  },
  {
    x: 90.3, y: 26.3, lx: 91, ly: 70,
    label: { en: "Add reply", ar: "Add reply" },
    more: {
      en: "A shortcut, a title and the text.",
      ar: "اختصار وعنوان والنص.",
    },
  },
];

const REPORT_NOTES: Note[] = [
  {
    x: 22, y: 22.8, lx: 24, ly: 64,
    label: { en: "Overview", ar: "Overview" },
    more: {
      en: "The whole period on a few pages: chats, response times, team, campaigns.",
      ar: "ملخص الفترة كاملة في صفحات قليلة: المحادثات، وأوقات الرد، والفريق، والحملات.",
    },
  },
  {
    x: 73.3, y: 22.8, lx: 75, ly: 64,
    label: { en: "Team performance", ar: "Team performance" },
    more: {
      en: "Per person: how fast they reply, late replies, follow-ups, busiest hours. PDF or CSV.",
      ar: "لكل موظف: سرعة الرد، والردود المتأخرة، والمتابعات، وأكثر الساعات ازدحاماً. بصيغة PDF أو CSV.",
    },
  },
  {
    x: 45.7, y: 41.5, lx: 48, ly: 76,
    label: { en: "Chats · Transcripts", ar: "Chats · Transcripts" },
    more: {
      en: "Every chat in the period as a list (PDF or Excel), or full conversations you pick (up to 100).",
      ar: "كل محادثات الفترة كقائمة (PDF أو Excel)، أو محادثات كاملة تختارها (حتى 100).",
    },
  },
];

const TEXT = {
  lead: {
    en: "Everything a supervisor does beyond answering chats: watch the team, make sure no patient waits, move chats between people, and keep the messages the team sends.",
    ar: "كل ما يقوم به المشرف إلى جانب الرد على المحادثات: متابعة الفريق، والتأكد من عدم انتظار أي مريض، ونقل المحادثات بين الموظفين، وإدارة الرسائل التي يرسلها الفريق.",
  },
  agentFirst: {
    en: "Answering a patient works the same for you as for agents:",
    ar: "الرد على المرضى يتم بنفس طريقة الموظفين:",
  },
  agentLink: { en: "see the agent guide", ar: "راجع دليل الموظف" },
  supervision: { en: "The Supervision page", ar: "صفحة Supervision" },
  supervisionText: {
    en: "Open Supervision from the eye icon on the left. It shows every chat on every WhatsApp line and updates by itself.",
    ar: "افتح Supervision من أيقونة العين على اليسار. تعرض كل المحادثات على كل أرقام واتساب، وتتحدث تلقائياً.",
  },
  targetTitle: { en: "The 30-minute target", ar: "هدف الـ 30 دقيقة" },
  target: {
    en: "Every patient should get a reply within 30 minutes of working time. Quiet hours (21:00–09:00) don't count, so a message sent at night starts the clock at 09:00.",
    ar: "يجب أن يحصل كل مريض على رد خلال 30 دقيقة من وقت العمل. ساعات الهدوء (21:00–09:00) لا تُحسب، فالرسالة التي تصل ليلاً يبدأ حسابها من الساعة 09:00.",
  },
  move: { en: "Moving a chat to someone else", ar: "نقل محادثة إلى موظف آخر" },
  moveSteps: [
    { en: "On Supervision, click the chat in the list. It opens on the right.", ar: "في صفحة Supervision اضغط على المحادثة في القائمة، فتظهر على اليمين." },
    { en: "Click the owner's name.", ar: "اضغط على اسم صاحب المحادثة." },
    { en: "Pick a colleague, Assign to me, or Unassign.", ar: "اختر زميلاً، أو Assign to me، أو Unassign." },
  ],
  otherLineTitle: { en: "A chat on another line", ar: "محادثة على رقم آخر" },
  otherLine: {
    en: "You can move a chat only while its line is the one shown at the top. If it isn't, the panel offers Switch to <line> first.",
    ar: "يمكنك نقل المحادثة فقط عندما يكون رقمها هو الرقم المختار في الأعلى. إن لم يكن كذلك، تظهر لك أولاً عبارة Switch to مع اسم الرقم.",
  },
  handover: { en: "Handing over someone's chats", ar: "تسليم محادثات موظف" },
  handoverText: {
    en: "When an agent goes home, on a break, or is off sick, move all their open chats in one go.",
    ar: "عندما ينهي موظف دوامه أو يأخذ استراحة أو يتغيب، انقل كل محادثاته المفتوحة دفعة واحدة.",
  },
  handoverSteps: [
    { en: "On their card on Supervision, click the ⇄ button.", ar: "في بطاقة الموظف في صفحة Supervision اضغط على زر ⇄." },
    { en: "Choose Back to the queue, or one colleague.", ar: "اختر Back to the queue أو زميلاً واحداً." },
    { en: "Press Hand over.", ar: "اضغط Hand over." },
  ],
  handoverNote: {
    en: "To hand over your own chats, use your status menu instead. Supervisors can't hand over an admin's chats.",
    ar: "لتسليم محادثاتك أنت، استخدم قائمة حالتك. ولا يستطيع المشرف تسليم محادثات المسؤول (Admin).",
  },
  templates: { en: "Patient-care templates", ar: "قوالب رعاية المرضى" },
  templatesText: {
    en: "Under Patient messages, WhatsApp templates are the messages agents can send even after the 24-hour window: appointment reminders, confirmations, results ready. You write them; WhatsApp approves them.",
    ar: "في صفحة Patient messages، قسم WhatsApp templates يحتوي على الرسائل التي يمكن للموظفين إرسالها حتى بعد مرور 24 ساعة: تذكير بالموعد، وتأكيد الموعد، وجاهزية النتائج. أنت تكتبها، وواتساب يوافق عليها.",
  },
  writeTitle: { en: "Writing one", ar: "كتابة قالب" },
  writeSteps: [
    { en: "Press New message and pick an example, or write your own.", ar: "اضغط New message واختر مثالاً، أو اكتب رسالتك." },
    { en: "Give it a name agents will recognise, like Appointment reminder.", ar: "اختر اسماً يعرفه الموظفون، مثل Appointment reminder." },
    { en: "Add blanks with the buttons above the message, and check the preview.", ar: "أضف الفراغات بالأزرار فوق الرسالة، وراجع المعاينة." },
    {
      en: "If you like, add a header (a bold line, a picture, a video or a PDF), a footer, and buttons: up to 2 links, 1 call button and quick replies. A link can end with the patient's first name.",
      ar: "يمكنك إضافة عنوان (سطر عريض أو صورة أو فيديو أو ملف PDF)، وتذييل، وأزرار: حتى رابطين، وزر اتصال واحد، وردود سريعة. يمكن أن ينتهي الرابط باسم المريض الأول.",
    },
    { en: "Tick the box, then press Send for approval.", ar: "ضع العلامة في المربع، ثم اضغط Send for approval." },
  ],
  noOffersTitle: { en: "No offers here", ar: "لا عروض هنا" },
  noOffers: {
    en: "These messages can't mention offers, discounts or prices, in the text, the buttons or the links. The app stops you while you type, and WhatsApp can still decide a message is marketing. If it does, agents can't use it: delete it and write it again without that wording. Offers go through Campaigns.",
    ar: "لا يمكن أن تذكر هذه الرسائل عروضاً أو خصومات أو أسعاراً، لا في النص ولا في الأزرار ولا في الروابط. يمنعك التطبيق أثناء الكتابة، وقد يقرر واتساب مع ذلك أن الرسالة تسويقية. في هذه الحالة لا يستطيع الموظفون استخدامها: احذفها واكتبها من جديد بدون تلك الكلمات. العروض تُرسل من خلال Campaigns.",
  },
  deleteNote: {
    en: "Deleting a template also removes it from WhatsApp, and its name can't be used again for 30 days.",
    ar: "حذف القالب يحذفه من واتساب أيضاً، ولا يمكن استخدام اسمه مرة أخرى لمدة 30 يوماً.",
  },
  saved: { en: "Saved replies", ar: "الردود الجاهزة" },
  savedText: {
    en: "Ready-made answers agents insert by typing / in a chat: opening hours, address, prices. You keep the list under Patient messages → Saved replies. Agents always check and can change the text before sending.",
    ar: "إجابات جاهزة يضيفها الموظفون بكتابة / في المحادثة: مواعيد العمل، والعنوان، والأسعار. أنت تدير القائمة من Patient messages ← Saved replies. يراجع الموظف النص دائماً ويمكنه تعديله قبل الإرسال.",
  },
  reports: { en: "Reports", ar: "التقارير" },
  reportsText: {
    en: "Press Report on Supervision. Pick a report, a period (up to 92 days) and a line. Times are Dubai time. Download PDF opens the print dialog: choose Save as PDF.",
    ar: "اضغط Report في صفحة Supervision. اختر التقرير والفترة (حتى 92 يوماً) والرقم. الأوقات بتوقيت دبي. زر Download PDF يفتح نافذة الطباعة: اختر Save as PDF.",
  },
};

function SupervisorGuide({ lang }: { lang: Lang }) {
  const t = (x: T) => x[lang];

  return (
    <>
      <Lead>{t(TEXT.lead)}</Lead>
      <P>
        {t(TEXT.agentFirst)} <DocLink to="agent-guide">{t(TEXT.agentLink)}</DocLink>.
      </P>

      <H>{t(TEXT.supervision)}</H>
      <P>{t(TEXT.supervisionText)}</P>
      <AnnotatedShot name="guide-sup-supervision" alt="The Supervision page" notes={SUPERVISION_NOTES} lang={lang} />
      <Callout tone="tip" title={t(TEXT.targetTitle)}>{t(TEXT.target)}</Callout>

      <H>{t(TEXT.move)}</H>
      <Steps items={TEXT.moveSteps.map(t)} />
      <AnnotatedShot name="guide-sup-reassign" alt="A chat open on Supervision with its owner menu open" notes={REASSIGN_NOTES} lang={lang} />
      <Callout tone="note" title={t(TEXT.otherLineTitle)}>{t(TEXT.otherLine)}</Callout>

      <H>{t(TEXT.handover)}</H>
      <P>{t(TEXT.handoverText)}</P>
      <Steps items={TEXT.handoverSteps.map(t)} />
      <AnnotatedShot name="guide-sup-handover" alt="Handing over an agent's open chats" notes={HANDOVER_NOTES} lang={lang} />
      <P>{t(TEXT.handoverNote)}</P>

      <H>{t(TEXT.templates)}</H>
      <P>{t(TEXT.templatesText)}</P>
      <AnnotatedShot name="guide-sup-templates" alt="Patient-care templates and their WhatsApp status" notes={TEMPLATE_NOTES} lang={lang} />
      <P><b>{t(TEXT.writeTitle)}</b></P>
      <Steps items={TEXT.writeSteps.map(t)} />
      <AnnotatedShot name="guide-sup-template-editor" alt="Writing a patient-care message" notes={EDITOR_NOTES} lang={lang} />
      <Callout tone="warn" title={t(TEXT.noOffersTitle)}>{t(TEXT.noOffers)}</Callout>
      <P>{t(TEXT.deleteNote)}</P>

      <H>{t(TEXT.saved)}</H>
      <P>{t(TEXT.savedText)}</P>
      <AnnotatedShot name="guide-sup-saved-replies" alt="The saved replies list" notes={SAVED_NOTES} lang={lang} />

      <H>{t(TEXT.reports)}</H>
      <P>{t(TEXT.reportsText)}</P>
      <AnnotatedShot name="guide-sup-reports" alt="The reports" notes={REPORT_NOTES} lang={lang} />
    </>
  );
}

const supervisorGuide: DocPage = {
  key: "supervisor-guide",
  label: "Supervisor guide · دليل المشرف",
  group: "Getting started",
  icon: ShieldCheck,
  description: "Supervision, moving chats, patient-care templates and saved replies, in English and Arabic",
  keywords: "supervisor quick start arabic عربي مشرف supervision team hand over reassign templates patient messages saved replies reports",
  // Supervisors' own page; admins see it by previewing the Supervisor role.
  visible: (ctx) => ctx.can("team:supervise", "conversation:assign", "template:write_utility") && !ctx.can("settings:write"),
  body: () => <Bilingual>{(_t, lang) => <SupervisorGuide lang={lang} />}</Bilingual>,
};

export const supervisorGuidePages: DocPage[] = [supervisorGuide];
