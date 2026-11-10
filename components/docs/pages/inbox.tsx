import { Bell, CalendarClock, Clock, Contact, Inbox, MessageSquareText, Ban, UserCheck } from "lucide-react";
import { rolesWith, type DocCtx, type DocPage } from "../model";
import { Bilingual, Bullets, Callout, DocLink, H, Kbd, Lead, P, Shot, Steps, Table, Ui, Who } from "../primitives";

// The inbox pages are in English and Arabic, like the agent guide: these are
// the pages the people answering patients read. Button and tab names stay in
// English (<Ui>) because that's how they appear in the app.

const GROUP = "Inbox";
const inboxUser = (ctx: DocCtx) => ctx.can("conversation:write");

const inbox: DocPage = {
  key: "inbox",
  label: "The inbox",
  group: GROUP,
  icon: Inbox,
  description: "Tabs, filters and what each chat row tells you",
  keywords: "chats conversations unread mine unassigned campaign replies follow-ups waiting search المحادثات",
  visible: inboxUser,
  body: (ctx) => (
    <Bilingual>
      {(t) => (
        <>
          <Who roles={rolesWith("conversation:write")} />
          <Lead>
            {t(
              "The inbox lists every WhatsApp conversation on the current line, newest message first. Click a chat to open it on the right.",
              "صندوق المحادثات يعرض كل محادثات واتساب على الرقم الحالي، الأحدث أولاً. اضغط على أي محادثة لفتحها على اليمين.",
            )}
          </Lead>
          <Shot name={ctx.role === "AGENT" ? "agent-inbox" : "inbox"} alt={t("The inbox", "صندوق المحادثات")} />
          <H>{t("Tabs", "التبويبات")}</H>
          <Table
            head={[t("Tab", "التبويب"), t("Shows", "يعرض")]}
            rows={[
              [<Ui key="t">All</Ui>, t("Every chat on the line.", "كل المحادثات على هذا الرقم.")],
              [<Ui key="t">Mine</Ui>, t("Chats assigned to you.", "المحادثات المُسندة إليك.")],
              [<Ui key="t">Unassigned</Ui>, t(
                "Chats nobody owns yet. The amber badge counts them. Start here when you're free.",
                "محادثات لم يستلمها أحد بعد، ويعدّها الرقم البرتقالي. ابدأ منها عندما تكون متاحاً.",
              )],
              [<Ui key="t">Campaign replies</Ui>, t("Patients who answered a campaign.", "المرضى الذين ردّوا على حملة تسويقية.")],
              [<Ui key="t">Follow-ups</Ui>, t(
                "Chats with a follow-up set, soonest first. The red badge counts the ones due now.",
                "محادثات عليها متابعة، الأقرب موعداً أولاً. الرقم الأحمر يعدّ المتابعات المستحقة الآن.",
              )],
            ]}
          />
          <P>
            {t(
              <>Under the tabs, the <Ui>All</Ui> · <Ui>Unread</Ui> · <Ui>Window closed</Ui> pills narrow the chats already loaded. The
                search box (<Ui>Search by name or number...</Ui>) searches every chat on the line, not just what&apos;s on screen. The
                list loads 50 chats at a time; scroll down for more.</>,
              <>تحت التبويبات، الأزرار <Ui>All</Ui> · <Ui>Unread</Ui> · <Ui>Window closed</Ui> تصفّي المحادثات المعروضة (الكل، غير
                المقروءة، المنتهية مهلتها). خانة البحث (<Ui>Search by name or number...</Ui>) تبحث في كل محادثات الرقم وليس فقط
                الظاهرة أمامك. تُحمَّل القائمة 50 محادثة في كل مرة؛ مرّر للأسفل لعرض المزيد.</>,
            )}
          </P>
          <H>{t("Reading a chat row", "قراءة سطر المحادثة")}</H>
          <Bullets
            items={[
              t(
                <>The <b>name</b> (or number), the time of the last message and a preview. <b>&ldquo;You:&rdquo;</b> means someone on the
                  team wrote last. A <b>⚡</b> means an automation (a flow) wrote last.</>,
                <><b>الاسم</b> (أو الرقم)، ووقت آخر رسالة، ومعاينة لها. <b>&ldquo;You:&rdquo;</b> تعني أن أحد أفراد الفريق كتب آخر
                  رسالة، و <b>⚡</b> تعني أن آخر رسالة أرسلها رد آلي (Flow).</>,
              ),
              t(<>A green <b>number bubble</b> counts unread messages.</>, <><b>الرقم الأخضر</b> يعدّ الرسائل غير المقروءة.</>),
              t(
                <><b>Waiting</b> timer: how long the patient has waited for a reply. Grey under 15 minutes,{" "}
                  <span className="text-amber-600 font-semibold">amber from 15</span>, <span className="text-red-600 font-semibold">red
                  from 30</span>.</>,
                <><b>مؤقت الانتظار</b>: المدة التي ينتظرها المريض للرد. رمادي أقل من 15 دقيقة،{" "}
                  <span className="text-amber-600 font-semibold">برتقالي من 15 دقيقة</span>، و{" "}
                  <span className="text-red-600 font-semibold">أحمر من 30 دقيقة</span>.</>,
              ),
              t(<>The owner&apos;s initials, or an amber <b>Unassigned</b>.</>, <>الأحرف الأولى لاسم صاحب المحادثة، أو <b>Unassigned</b> باللون البرتقالي إذا لم يستلمها أحد.</>),
              t(
                <>A red row with <b>Window closed</b>: the patient last wrote more than 24 hours ago. Only templates can be sent. See{" "}
                  <DocLink to="window">The 24-hour window</DocLink>.</>,
                <>سطر أحمر مكتوب عليه <b>Window closed</b>: آخر رسالة من المريض كانت قبل أكثر من 24 ساعة، ولا يمكن إرسال إلا قوالب
                  معتمدة. راجع <DocLink to="window">مهلة الـ 24 ساعة</DocLink>.</>,
              ),
              t(
                <>A <b>Follow up</b> chip when a follow-up is set. It turns red once it&apos;s due.</>,
                <>شارة <b>Follow up</b> عند وجود متابعة، وتتحول إلى الأحمر عند حلول موعدها.</>,
              ),
            ]}
          />
          <Callout tone="tip">
            {t(
              "Drag the edge of the chat list to make it wider (up to 30% of the window). Double-click the edge to reset it.",
              "اسحب حافة قائمة المحادثات لتوسيعها (حتى 30% من الشاشة). انقر مرتين على الحافة لإرجاعها كما كانت.",
            )}
          </Callout>
          <H>{t("Searching messages", "البحث في الرسائل")}</H>
          <P>
            {t(
              <>To find a message by its text across every chat on the line, open <b>/search</b>. It shows the 20 most recent matches,
                each with a link to its conversation. To search inside one chat, use <Ui>Search</Ui> in its contact panel.</>,
              <>للبحث عن رسالة بنصّها في كل محادثات الرقم، افتح صفحة <b>/search</b>. تعرض آخر 20 نتيجة، ولكل نتيجة رابط لمحادثتها.
                وللبحث داخل محادثة واحدة استخدم <Ui>Search</Ui> في لوحة بيانات المريض.</>,
            )}
          </P>
        </>
      )}
    </Bilingual>
  ),
};

const chatting: DocPage = {
  key: "chatting",
  label: "Replying to patients",
  group: GROUP,
  icon: MessageSquareText,
  description: "Text, saved replies, files, what patients send, message status",
  keywords:
    "send message reply media image pdf attach emoji saved replies slash / voice note location sticker reaction delete copy quote ticks read delivered viewing typing seen by take over الرد الردود الجاهزة",
  visible: inboxUser,
  body: (ctx) => (
    <Bilingual>
      {(t) => (
        <>
          <Who roles={rolesWith("message:send")} />
          <Lead>
            {t(
              <>Open a chat from the inbox. The header shows the patient, their follow-up and who owns the chat.</>,
              <>افتح المحادثة من صندوق المحادثات. يعرض أعلى المحادثة اسم المريض والمتابعة وصاحب المحادثة.</>,
            )}
          </Lead>
          <Shot name="chat" alt={t("An open conversation", "محادثة مفتوحة")} />

          <H>{t("Sending text", "إرسال رسالة نصية")}</H>
          <Bullets
            items={[
              t(
                <>Type in <Ui>Type a message...</Ui> and press <Kbd>Enter</Kbd> (or click <Ui>Send</Ui>). <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>{" "}
                  adds a new line.</>,
                <>اكتب في خانة <Ui>Type a message...</Ui> ثم اضغط <Kbd>Enter</Kbd> (أو <Ui>Send</Ui>). للانتقال إلى سطر جديد اضغط{" "}
                  <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>.</>,
              ),
              t(<>The smiley button opens the emoji picker.</>, <>زر الوجه المبتسم يفتح قائمة الإيموجي.</>),
              t(
                <>WhatsApp formatting works: <b>*bold*</b>, <i>_italic_</i>, <s>~strike~</s>. The chat shows it the way the patient sees it.</>,
                <>تنسيق واتساب يعمل: <b>*عريض*</b> و <i>_مائل_</i> و <s>~يتوسطه خط~</s>. تظهر الرسالة في المحادثة كما يراها المريض.</>,
              ),
              t(
                <>Arabic text reads right-to-left by itself, in the chat and in the box you type in.</>,
                <>النص العربي يُعرض من اليمين إلى اليسار تلقائياً، في المحادثة وفي خانة الكتابة.</>,
              ),
              t(
                <>While you type, the patient sees WhatsApp&apos;s &ldquo;typing…&rdquo;. A double click or a double <Kbd>Enter</Kbd> still
                  sends the message only once.</>,
                <>أثناء الكتابة يرى المريض &ldquo;يكتب…&rdquo; في واتساب. الضغط مرتين على Send أو <Kbd>Enter</Kbd> يرسل الرسالة مرة
                  واحدة فقط.</>,
              ),
            ]}
          />

          {ctx.can("saved_reply:read") && (
            <>
              <H>{t("Saved replies", "الردود الجاهزة")}</H>
              <P>
                {t(
                  <>Ready-made answers for common questions, such as opening hours or prices. Type <Kbd>/</Kbd> in the message box, or
                    click the speech-bubble button next to the emoji button.</>,
                  <>إجابات جاهزة للأسئلة المتكررة مثل مواعيد العمل أو الأسعار. اكتب <Kbd>/</Kbd> في خانة الرسالة، أو اضغط زر فقاعة
                    الكلام بجانب زر الإيموجي.</>,
                )}
              </P>
              <Steps
                items={[
                  t(
                    <>Keep typing after the <Kbd>/</Kbd> to search, for example <b>/hours</b>.</>,
                    <>تابع الكتابة بعد <Kbd>/</Kbd> للبحث، مثلاً <b>/hours</b>.</>,
                  ),
                  t(
                    <>Use <Kbd>↑</Kbd> <Kbd>↓</Kbd> to choose, and <Kbd>Enter</Kbd> or <Kbd>Tab</Kbd> to insert it. <Kbd>Esc</Kbd> closes
                      the list.</>,
                    <>استخدم <Kbd>↑</Kbd> <Kbd>↓</Kbd> للاختيار، ثم <Kbd>Enter</Kbd> أو <Kbd>Tab</Kbd> للإضافة. <Kbd>Esc</Kbd> يغلق
                      القائمة.</>,
                  ),
                  t(
                    <>The reply goes into the box with the patient&apos;s name filled in. Check it, change it if needed, then press{" "}
                      <Ui>Send</Ui>.</>,
                    <>يُضاف الرد إلى خانة الكتابة مع اسم المريض. راجعه وعدّله إن لزم، ثم اضغط <Ui>Send</Ui>.</>,
                  ),
                ]}
              />
              <Callout tone="note">
                {t(
                  <>Nothing is sent by itself: a saved reply only fills the box. {ctx.can("saved_reply:write")
                    ? <>You can add and edit saved replies in <b>Patient Messages</b>.</>
                    : <>Supervisors and admins write the saved replies.</>}</>,
                  <>لا يُرسل أي شيء تلقائياً: الرد الجاهز يملأ خانة الكتابة فقط. {ctx.can("saved_reply:write")
                    ? <>يمكنك إضافة الردود الجاهزة وتعديلها من صفحة <b>Patient Messages</b>.</>
                    : <>المشرفون ومديرو النظام هم من يكتبون الردود الجاهزة.</>}</>,
                )}
              </Callout>
              <Shot name="guide-saved-replies" alt={t("The saved replies list above the message box", "قائمة الردود الجاهزة فوق خانة الكتابة")} />
            </>
          )}

          <H>{t("Sending files", "إرسال الملفات")}</H>
          <Steps
            items={[
              t(
                <>Click the paperclip, or drag files onto the chat (you&apos;ll see <b>Drop files to send</b>).</>,
                <>اضغط على مشبك الورق، أو اسحب الملفات إلى المحادثة (ستظهر عبارة <b>Drop files to send</b>).</>,
              ),
              t(
                <>In the preview, add an optional caption for each file. Use <b>+</b> to add more files and <b>×</b> to remove one.</>,
                <>في المعاينة، أضف تعليقاً لكل ملف إن أردت. استخدم <b>+</b> لإضافة ملفات أخرى و <b>×</b> لحذف ملف.</>,
              ),
              t(
                <>Click send. Each caption goes out as a short text just before its file.</>,
                <>اضغط إرسال. يُرسل كل تعليق كرسالة نصية قصيرة قبل ملفه مباشرة.</>,
              ),
            ]}
          />
          <P>
            {t(
              <>Allowed: images, MP4/3GPP video, audio, PDF, Word and Excel, up to <b>16 MB</b> per file.</>,
              <>المسموح: الصور، والفيديو بصيغة MP4/3GPP، والصوت، وملفات PDF و Word و Excel، بحد أقصى <b>16 ميغابايت</b> للملف.</>,
            )}
          </P>

          <H>{t("What patients can send you", "ما يمكن أن يرسله المريض")}</H>
          <Table
            head={[t("They send", "يرسل"), t("You see", "يظهر لك")]}
            rows={[
              [t("Photo, video, sticker", "صورة، فيديو، ملصق"), t("The picture or video in the chat. Click a photo to enlarge it.", "الصورة أو الفيديو داخل المحادثة. اضغط على الصورة لتكبيرها.")],
              [t("Voice note", "رسالة صوتية"), t("A player: press play to listen.", "مشغّل صوت: اضغط تشغيل للاستماع.")],
              [t("Document", "مستند"), t("A file card with its name. Click it to open or download.", "بطاقة ملف باسمه. اضغط عليها للفتح أو التنزيل.")],
              [t("Location", "موقع"), t("A location card with the place's name and address. Click it to open the map.", "بطاقة موقع فيها اسم المكان وعنوانه. اضغط عليها لفتح الخريطة.")],
              [t("Reaction (👍 ❤️ …)", "تفاعل (👍 ❤️ …)"), t("A small emoji under the message they reacted to.", "إيموجي صغير تحت الرسالة التي تفاعل معها.")],
              [t("Anything else (a poll, a contact card…)", "أي شيء آخر (استطلاع، بطاقة جهة اتصال…)"), t(
                "An \"Unsupported message\" card. Ask the patient to send it as text or a photo.",
                "بطاقة \"Unsupported message\" (رسالة غير مدعومة). اطلب من المريض إرسالها كنص أو صورة.",
              )],
            ]}
          />

          <H>{t("Message status", "حالة الرسالة")}</H>
          <Table
            head={[t("Mark", "العلامة"), t("Meaning", "المعنى")]}
            rows={[
              [t("Animated dots", "نقاط متحركة"), t("Sending", "جارٍ الإرسال")],
              ["✓", t("Sent to WhatsApp", "أُرسلت إلى واتساب")],
              ["✓✓", t("Delivered to the patient's phone", "وصلت إلى هاتف المريض")],
              [<span key="r" className="text-sky-600 font-bold">✓✓</span>, t("Read", "قرأها المريض")],
              [<span key="f" className="text-red-600 font-bold">!</span>, t("Not delivered. Hover it for the reason.", "لم تصل. مرّر الماوس فوقها لمعرفة السبب.")],
            ]}
          />
          <P>
            {t(
              <>Team messages are green and show who sent them. Automation messages are grey with an <b>Automation</b> label. A
                patient&apos;s reply to a campaign shows <b>Reply to &ldquo;campaign name&rdquo;</b> above it.</>,
              <>رسائل الفريق خضراء ويظهر فوقها اسم من أرسلها. الرسائل الآلية رمادية وعليها <b>Automation</b>. وإذا ردّ المريض على حملة
                يظهر فوق رده <b>Reply to &ldquo;اسم الحملة&rdquo;</b>.</>,
            )}
          </P>

          <H>{t("The message menu", "قائمة الرسالة")}</H>
          <P>{t("Hover a message and click the small arrow to:", "مرّر الماوس فوق الرسالة واضغط السهم الصغير لـ:")}</P>
          <Bullets
            items={[
              t(
                <><Ui>Reply</Ui>: quote it. A bar appears above the message box; × cancels it.</>,
                <><Ui>Reply</Ui>: الرد على رسالة محددة. يظهر شريط فوق خانة الكتابة، و × يلغيه.</>,
              ),
              t(<><Ui>Copy</Ui>: copy the text.</>, <><Ui>Copy</Ui>: نسخ النص.</>),
              t(
                <><Ui>Delete</Ui>: only your own sent messages. It removes the message here, but <b>WhatsApp can&apos;t recall it</b>. The
                  patient&apos;s copy stays.</>,
                <><Ui>Delete</Ui>: لرسائلك فقط. تُحذف الرسالة من هنا، لكن <b>واتساب لا يسحبها</b> من عند المريض، فتبقى عنده.</>,
              ),
            ]}
          />

          <H>{t("Replying in a colleague's chat", "الرد في محادثة زميل")}</H>
          <P>
            {t(
              <>If the chat belongs to someone else, you&apos;re asked once: <b>&ldquo;This chat is assigned to …&rdquo;</b>. Click{" "}
                <Ui>Reply anyway</Ui> to send. The owner sees your reply in their chat.</>,
              <>إذا كانت المحادثة لزميل آخر، يُطلب منك التأكيد مرة واحدة: <b>&ldquo;This chat is assigned to …&rdquo;</b>. اضغط{" "}
                <Ui>Reply anyway</Ui> للإرسال، وسيرى صاحب المحادثة ردك.</>,
            )}
          </P>
          <H>{t("Who else is in the chat", "من يشاهد المحادثة معك")}</H>
          <P>
            {t(
              <>Small avatars next to the patient&apos;s name show colleagues who have the same chat open right now. They turn amber with
                &ldquo;is typing…&rdquo; while one of them is writing, so two people don&apos;t answer the same patient at once.</>,
              <>الصور الصغيرة بجانب اسم المريض تُظهر الزملاء الذين يفتحون نفس المحادثة الآن. وتتحول إلى البرتقالي مع &ldquo;is
                typing…&rdquo; عندما يكتب أحدهم، حتى لا يرد شخصان على نفس المريض في الوقت نفسه.</>,
            )}
          </P>
          {ctx.can("team:supervise") && (
            <P>
              {t(
                <><b>Seen by</b> (in the contact panel, and on a chat in Supervision) lists who opened the chat while it belonged to
                  someone else, how many times and when. Only supervisors and admins see it; opening your own chat or an unassigned one
                  isn&apos;t recorded.</>,
                <><b>Seen by</b> (في لوحة بيانات المريض، وفي صفحة Supervision) يعرض من فتح المحادثة وهي لزميل آخر، وكم مرة، ومتى.
                  يراه المشرفون ومديرو النظام فقط، ولا يُسجَّل فتح محادثتك أو محادثة غير مُسندة.</>,
              )}
            </P>
          )}
        </>
      )}
    </Bilingual>
  ),
};

const windowPage: DocPage = {
  key: "window",
  label: "The 24-hour window",
  group: GROUP,
  icon: Clock,
  description: "Free text within 24 hours, templates and their blanks",
  keywords: "24h window closed template re-engagement approved meta fill in date time doctor branch appointment reminder مهلة قالب موعد",
  visible: inboxUser,
  body: () => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              <>WhatsApp only lets a business send free-form messages within <b>24 hours of the patient&apos;s last message</b>. After
                that, you can only start the conversation again with a template Meta has approved.</>,
              <>يسمح واتساب بإرسال رسائل عادية فقط خلال <b>24 ساعة من آخر رسالة أرسلها المريض</b>. بعد ذلك لا يمكنك إعادة فتح المحادثة
                إلا بقالب (Template) معتمد من Meta.</>,
            )}
          </Lead>
          <Shot
            name="chat-window-closed"
            alt={t("A chat whose 24-hour window has closed", "محادثة انتهت مهلة الـ 24 ساعة فيها")}
            caption={t(
              "Window closed: the message box is locked and the Template button turns red.",
              "انتهت المهلة: خانة الكتابة مقفلة وزر Template أصبح أحمر.",
            )}
          />
          <H>{t("When the window is closed", "عند انتهاء المهلة")}</H>
          <Bullets
            items={[
              t(
                <>The message box is disabled and says <b>Messaging disabled — 24h window closed</b>.</>,
                <>تُقفل خانة الكتابة ويظهر فيها <b>Messaging disabled — 24h window closed</b>.</>,
              ),
              t(
                <>A contact who has never written counts as closed. Start with a template.</>,
                <>المريض الذي لم يراسلك من قبل تُعتبر محادثته مغلقة، فابدأ بقالب.</>,
              ),
              t(
                <>If you were typing when the window closed, your text is kept, an error appears and the template picker opens.</>,
                <>إذا انتهت المهلة وأنت تكتب، يبقى نصك محفوظاً، وتظهر رسالة خطأ، وتُفتح قائمة القوالب.</>,
              ),
            ]}
          />
          <H>{t("Sending a template", "إرسال قالب")}</H>
          <Steps
            items={[
              t(<>Click <Ui>Template</Ui> next to the message box.</>, <>اضغط <Ui>Template</Ui> بجانب خانة الكتابة.</>),
              t(
                <>Inside the window you get <b>Insert Template</b>: approved general templates and patient-care templates (appointment
                  reminders, results ready…). Outside it you get <b>Send an approved template</b>: only templates Meta approved.</>,
                <>خلال المهلة تظهر نافذة <b>Insert Template</b>: القوالب العامة المعتمدة وقوالب رعاية المرضى (تذكير بموعد، جاهزية
                  النتائج…). بعد انتهاء المهلة تظهر <b>Send an approved template</b>: القوالب المعتمدة من Meta فقط.</>,
              ),
              t(
                <>Pick one. If it has blanks, fill them in (see below).</>,
                <>اختر القالب. إذا كان فيه فراغات، املأها (انظر بالأسفل).</>,
              ),
              t(
                <>Check the <b>Preview</b>: it shows the patient&apos;s name and what you typed. Then click <Ui>Send Template</Ui> or{" "}
                  <Ui>Send Re-engagement</Ui>.</>,
                <>راجع <b>Preview</b>: تظهر فيها رسالة المريض باسمه وبما كتبته. ثم اضغط <Ui>Send Template</Ui> أو{" "}
                  <Ui>Send Re-engagement</Ui>.</>,
              ),
            ]}
          />
          <Shot name="chat-template-picker" alt={t("The template picker", "قائمة القوالب")} />
          <H>{t("Templates with blanks: date, time, doctor…", "قوالب فيها فراغات: التاريخ، الوقت، الطبيب…")}</H>
          <P>
            {t(
              <>Patient-care templates such as an appointment reminder have blanks the app can&apos;t know, so <b>you type them each time
                you send</b>. Nothing is taken from a calendar or a booking.</>,
              <>قوالب رعاية المرضى مثل التذكير بالموعد فيها فراغات لا يعرفها النظام، لذلك <b>تكتبها أنت في كل مرة ترسل فيها</b>.
                لا يُؤخذ أي شيء من التقويم أو من الحجوزات.</>,
            )}
          </P>
          <Table
            head={[t("Blank", "الفراغ"), t("Filled by", "من يملؤه")]}
            rows={[
              [t("Patient's first name", "الاسم الأول للمريض"), t(
                "Automatically, from the contact's name. No name saved? It says \"Customer\".",
                "تلقائياً من اسم المريض المحفوظ. إذا لم يكن هناك اسم يُكتب \"Customer\".",
              )],
              [<><Ui>Date</Ui> · <Ui>Time</Ui> · <Ui>Doctor</Ui> · <Ui>Branch</Ui> · <Ui>Details</Ui></>, t(
                "You, in the Fill in boxes that appear when you pick the template.",
                "أنت، في خانات Fill in التي تظهر عند اختيار القالب.",
              )],
            ]}
          />
          <Bullets
            items={[
              t(
                <>Each box shows an example, like <i>e.g. Monday 10 November</i> or <i>e.g. 4:30 PM</i>. Write it the way the patient
                  should read it. Arabic is fine: <i>الاثنين 10 نوفمبر</i>.</>,
                <>كل خانة فيها مثال، مثل <i>e.g. Monday 10 November</i> أو <i>e.g. 4:30 PM</i>. اكتب القيمة كما تريد أن يقرأها
                  المريض، والعربية مقبولة: <i>الاثنين 10 نوفمبر</i>.</>,
              ),
              t(
                <>The preview shows <b>[Date]</b>, <b>[Time]</b>… for any box still empty, and <Ui>Send Template</Ui> stays disabled
                  until every box is filled.</>,
                <>تُظهر المعاينة <b>[Date]</b> و <b>[Time]</b>… لكل خانة فارغة، ويبقى زر <Ui>Send Template</Ui> معطلاً حتى تملأ كل
                  الخانات.</>,
              ),
              t(
                <>What you type is sent exactly as written, on one line. Double-check the date and time before sending.</>,
                <>يُرسل ما تكتبه كما هو وفي سطر واحد، فراجع التاريخ والوقت جيداً قبل الإرسال.</>,
              ),
            ]}
          />
          <Callout tone="warn" title={t("Opted-out patients", "المرضى الذين ألغوا الاشتراك")}>
            {t(
              <>If the patient opted out, marketing templates are hidden from the picker and can&apos;t be sent. Patient-care templates
                still work. See <DocLink to="opt-outs">Opt-outs</DocLink>.</>,
              <>إذا ألغى المريض الاشتراك في الرسائل التسويقية، تختفي القوالب التسويقية من القائمة ولا يمكن إرسالها، لكن قوالب رعاية
                المرضى تبقى متاحة. راجع <DocLink to="opt-outs">إلغاء الاشتراك</DocLink>.</>,
            )}
          </Callout>
          <P>
            {t(
              <>No suitable template? Ask a supervisor: patient-care templates are written in <b>Patient Messages</b> and need Meta&apos;s
                approval before they appear here.</>,
              <>لا يوجد قالب مناسب؟ اطلب من المشرف: قوالب رعاية المرضى تُكتب في صفحة <b>Patient Messages</b> وتحتاج موافقة Meta قبل
                أن تظهر هنا.</>,
            )}
          </P>
        </>
      )}
    </Bilingual>
  ),
};

const ownership: DocPage = {
  key: "ownership",
  label: "Assigning & handing over",
  group: GROUP,
  icon: UserCheck,
  description: "Who owns a chat, taking over and handing over at the end of a shift",
  keywords: "assign assignee claim owner take over hand over shift end إسناد تسليم",
  visible: inboxUser,
  body: (ctx) => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              "Every chat has at most one owner. Owning a chat means the patient is waiting on you.",
              "لكل محادثة صاحب واحد على الأكثر. أن تكون صاحب المحادثة يعني أن المريض ينتظر ردك أنت.",
            )}
          </Lead>
          <H>{t("Taking and assigning chats", "استلام المحادثات وإسنادها")}</H>
          <Bullets
            items={[
              t(
                <><b>New chats are given out automatically.</b> When a patient writes and nobody owns the chat, it goes straight to
                  the online agent with the fewest open chats (taking turns when level), who gets an alert. With nobody online, it
                  waits in <b>Unassigned</b> and is shared out when agents come online. An admin can turn this off in Settings →
                  Assigning chats.</>,
                <><b>المحادثات الجديدة تُوزَّع تلقائياً.</b> عندما يكتب مريض ولا أحد مسؤول عن محادثته، تذهب فوراً للموظف المتصل
                  صاحب أقل عدد من المحادثات المفتوحة (بالتناوب عند التساوي)، ويصله تنبيه. إذا لم يكن أحد متصلاً، تنتظر في{" "}
                  <b>Unassigned</b> وتُوزَّع عند اتصال الموظفين. يمكن للمدير إيقاف ذلك من Settings → Assigning chats.</>,
              ),
              t(
                <><b>Replying claims the chat.</b> Send a message, file or template in an unassigned chat and it becomes yours. If two
                  people send at once, the first one takes it and the other is asked before their message goes out, so the patient
                  never gets two replies by accident.</>,
                <><b>الرد يجعل المحادثة لك.</b> أرسل رسالة أو ملفاً أو قالباً في محادثة غير مُسندة فتصبح محادثتك. وإذا أرسل شخصان في
                  نفس اللحظة، تكون للأسبق، ويُسأل الآخر قبل إرسال رسالته، فلا يصل المريض ردّان بالخطأ.</>,
              ),
              ctx.can("conversation:assign")
                ? t(
                    <>The assignee button in the header (your name, or <b>Unassigned</b>) lets you <Ui>Assign to me</Ui>, pick a teammate
                      (a dot shows whether they&apos;re online, on break or offline), or <Ui>Unassign</Ui>.</>,
                    <>زر صاحب المحادثة في الأعلى (اسمك أو <b>Unassigned</b>) يتيح لك <Ui>Assign to me</Ui> (إسنادها لنفسك)، أو اختيار
                      زميل (تُظهر النقطة إن كان متاحاً أو في استراحة أو غير متصل)، أو <Ui>Unassign</Ui> (إلغاء الإسناد).</>,
                  )
                : t(
                    <>Your role can&apos;t reassign chats. The header shows who owns it.</>,
                    <>صلاحياتك لا تسمح بإعادة إسناد المحادثات. يظهر صاحب المحادثة في الأعلى.</>,
                  ),
              ...(ctx.can("conversation:assign") && !ctx.can("team:supervise")
                ? [t(
                    <>A <b>colleague&apos;s chat</b> is theirs to hand over or follow up. You can read it and reply, and{" "}
                      <Ui>Take over</Ui> it yourself only while they&apos;re on a break or offline — you&apos;re asked to confirm, and the
                      switch is recorded. If they&apos;re online, ask them or a supervisor.</>,
                    <><b>محادثة الزميل</b> تخصه هو في التسليم والمتابعة. يمكنك قراءتها والرد فيها، ويمكنك <Ui>Take over</Ui> (أخذها)
                      فقط إذا كان في استراحة أو غير متصل — سيُطلب منك التأكيد ويُسجَّل التغيير. إذا كان متاحاً، اطلب منه أو من المشرف.</>,
                  )]
                : ctx.can("team:supervise")
                  ? [t(
                      <>As a supervisor you can reassign or follow up <b>any</b> chat. Agents can only change their own and unassigned
                        ones, and take over a colleague&apos;s chat while that colleague is away.</>,
                      <>كمشرف يمكنك إعادة إسناد <b>أي</b> محادثة أو وضع متابعة عليها. الموظفون يغيّرون محادثاتهم وغير المُسندة فقط،
                        ويأخذون محادثة الزميل عندما يكون غائباً.</>,
                    )]
                  : []),
              t(
                <>If a colleague changed the owner a moment before you, you&apos;re told who has it now. Nothing is overwritten.</>,
                <>إذا غيّر زميل صاحب المحادثة قبلك بلحظة، يظهر لك من استلمها. لا يُلغى تغيير أحد.</>,
              ),
            ]}
          />
          <H>{t("End of shift: hand over your chats", "نهاية الدوام: تسليم محادثاتك")}</H>
          <Steps
            items={[
              t(
                <>Click your status at the bottom of the inbox list, then <Ui>Hand over my chats…</Ui>.</>,
                <>اضغط على حالتك أسفل قائمة المحادثات، ثم <Ui>Hand over my chats…</Ui>.</>,
              ),
              t(
                <>Choose <Ui>Back to the queue</Ui> (your chats become Unassigned) or a colleague.</>,
                <>اختر <Ui>Back to the queue</Ui> (تصبح محادثاتك غير مُسندة) أو اختر زميلاً.</>,
              ),
              t(
                <>Click <Ui>Hand over</Ui>.</>,
                <>اضغط <Ui>Hand over</Ui>.</>,
              ),
            ]}
          />
          <Shot name="agent-status-menu" alt={t("The status menu with Hand over my chats", "قائمة الحالة وفيها Hand over my chats")} />
          {ctx.can("team:supervise") && (
            <P>
              {t(
                <>Supervisors can also hand over someone else&apos;s work from the Supervision page. See{" "}
                  <DocLink to="supervision">Supervision</DocLink>.</>,
                <>يمكن للمشرفين أيضاً تسليم محادثات أي موظف من صفحة Supervision. راجع <DocLink to="supervision">Supervision</DocLink>.</>,
              )}
            </P>
          )}
        </>
      )}
    </Bilingual>
  ),
};

const outcomes: DocPage = {
  key: "outcomes",
  label: "Follow-ups",
  group: GROUP,
  icon: CalendarClock,
  description: "Set a follow-up, get reminded, cancel it",
  keywords: "follow up follow-up reminder due overdue cancel change outcome متابعة تذكير",
  visible: inboxUser,
  body: () => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              <>A follow-up is a reminder to get back to a patient at a set time. Set one whenever you&apos;re waiting on the patient,
                such as when they need to check their calendar or said they&apos;ll call back.</>,
              <>المتابعة تذكير بالعودة إلى المريض في وقت محدد. استخدمها كلما كنت تنتظر شيئاً من المريض، مثل أن يراجع مواعيده أو يقول
                إنه سيتصل لاحقاً.</>,
            )}
          </Lead>
          <Shot name="chat-outcome-menu" alt={t("The Follow up menu in the chat header", "قائمة Follow up أعلى المحادثة")} />
          <H>{t("Setting a follow-up", "وضع متابعة")}</H>
          <Steps
            items={[
              t(
                <>In the chat header, click the <Ui>Follow up</Ui> chip and choose <Ui>Follow up…</Ui>.</>,
                <>أعلى المحادثة، اضغط على <Ui>Follow up</Ui> ثم اختر <Ui>Follow up…</Ui>.</>,
              ),
              t(
                <>Pick <Ui>In 1 hour</Ui>, <Ui>Tomorrow 10:00</Ui> (the default), <Ui>In 3 days</Ui>, or any date and time in{" "}
                  <Ui>Follow up on</Ui>.</>,
                <>اختر <Ui>In 1 hour</Ui> (بعد ساعة)، أو <Ui>Tomorrow 10:00</Ui> (غداً الساعة 10، وهو الافتراضي)، أو{" "}
                  <Ui>In 3 days</Ui> (بعد 3 أيام)، أو أي تاريخ ووقت في <Ui>Follow up on</Ui>.</>,
              ),
              t(
                <>Click <Ui>Set follow-up</Ui>. The chip shows the date from then on.</>,
                <>اضغط <Ui>Set follow-up</Ui>. سيظهر الموعد على الزر من الآن.</>,
              ),
            ]}
          />
          <H>{t("What happens next", "ماذا يحدث بعد ذلك")}</H>
          <Bullets
            items={[
              t(
                <>The chat appears in the inbox&apos;s <Ui>Follow-ups</Ui> tab, soonest first, and its chip turns red once it&apos;s due.</>,
                <>تظهر المحادثة في تبويب <Ui>Follow-ups</Ui>، الأقرب موعداً أولاً، ويتحول الزر إلى الأحمر عند حلول الموعد.</>,
              ),
              t(
                <>When it&apos;s due, you get one reminder card: &ldquo;Follow up now · patient&rdquo;. It goes to the chat&apos;s owner,
                  or to whoever set it, or to everyone on the line. Reminders are checked every 5 minutes.</>,
                <>عند حلول الموعد تصلك بطاقة تذكير واحدة: &ldquo;Follow up now · اسم المريض&rdquo;. تذهب لصاحب المحادثة، أو لمن وضع
                  المتابعة، أو لكل من على الرقم. يتم فحص التذكيرات كل 5 دقائق.</>,
              ),
              t(
                <><b>The patient writes again?</b> The follow-up is cancelled automatically: they&apos;re back in touch, so the chat is
                  simply waiting for a reply again.</>,
                <><b>كتب المريض مرة أخرى؟</b> تُلغى المتابعة تلقائياً لأنه عاد للتواصل، وتصبح المحادثة بانتظار ردك فقط.</>,
              ),
            ]}
          />
          <H>{t("Changing or cancelling it", "تعديل المتابعة أو إلغاؤها")}</H>
          <P>
            {t(
              <>Click the chip again: <Ui>Change follow-up…</Ui> picks a new time, and <Ui>Cancel follow-up</Ui> removes it.</>,
              <>اضغط على الزر مرة أخرى: <Ui>Change follow-up…</Ui> لاختيار وقت جديد، و <Ui>Cancel follow-up</Ui> لإلغائها.</>,
            )}
          </P>
          <P>
            {t(
              <>The same menu also has <Ui>Opt out of marketing…</Ui>. See <DocLink to="opt-outs">Opt-outs</DocLink>.</>,
              <>في نفس القائمة يوجد أيضاً <Ui>Opt out of marketing…</Ui>. راجع <DocLink to="opt-outs">إلغاء الاشتراك</DocLink>.</>,
            )}
          </P>
        </>
      )}
    </Bilingual>
  ),
};

const contactPanel: DocPage = {
  key: "contact-panel",
  label: "Contact panel & notes",
  group: GROUP,
  icon: Contact,
  description: "Patient details, notes, tags and shared media",
  keywords: "contact info panel notes internal tags media docs links search chat ملاحظات بيانات المريض",
  visible: inboxUser,
  body: () => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              "Click the patient's name in the chat header (or the panel button on the right) to open the contact panel.",
              "اضغط على اسم المريض أعلى المحادثة (أو زر اللوحة على اليمين) لفتح لوحة بيانات المريض.",
            )}
          </Lead>
          <Shot name="chat-contact-panel" alt={t("The contact panel beside a chat", "لوحة بيانات المريض بجانب المحادثة")} />
          <Table
            head={[t("Section", "القسم"), t("What's in it", "ما فيه")]}
            rows={[
              [t("Identity", "البيانات"), t(
                "Name, email, chart number and nationality, editable in place. Copy the number. Search this chat. Open the full contact.",
                "الاسم والبريد الإلكتروني ورقم الملف والجنسية، ويمكن تعديلها مباشرة. نسخ الرقم، والبحث في المحادثة، وفتح ملف المريض كاملاً.",
              )],
              [t("Follow-up", "المتابعة"), t(
                "The follow-up (when it's due and who set it) and the waiting timer.",
                "المتابعة (موعدها ومن وضعها) ومؤقت الانتظار.",
              )],
              [t("Patient notes", "ملاحظات المريض"), t("Long-term notes stored on the contact.", "ملاحظات دائمة محفوظة على ملف المريض.")],
              [t("Chat notes", "ملاحظات المحادثة"), t(
                "Staff-only notes on this chat (up to 2000 characters). Never sent to the patient.",
                "ملاحظات داخلية للفريق على هذه المحادثة (حتى 2000 حرف). لا تُرسل للمريض أبداً.",
              )],
              [t("Tags", "الوسوم"), t("Labels used for filtering.", "تصنيفات تُستخدم في التصفية.")],
              [t("Media, links and docs", "الوسائط والروابط والمستندات"), t(
                "Everything shared in the chat. Click one to jump to its message.",
                "كل ما تمت مشاركته في المحادثة. اضغط على أي عنصر للانتقال إلى رسالته.",
              )],
              [t("Campaigns received", "الحملات المستلمة"), t("Which campaigns reached this patient.", "الحملات التي وصلت لهذا المريض.")],
            ]}
          />
          <Callout tone="tip">
            {t(
              <>Add a chat note with <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>. You can delete your own notes; supervisors can delete
                anyone&apos;s.</>,
              <>أضف ملاحظة المحادثة بالضغط على <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>. يمكنك حذف ملاحظاتك فقط، والمشرفون يحذفون ملاحظات
                الجميع.</>,
            )}
          </Callout>
        </>
      )}
    </Bilingual>
  ),
};

const optOuts: DocPage = {
  key: "opt-outs",
  label: "Opt-outs",
  group: GROUP,
  icon: Ban,
  description: "STOP, do-not-contact and what you may still send",
  keywords: "opt out stop unsubscribe start marketing do not contact lift إلغاء الاشتراك توقف",
  visible: (ctx) => ctx.can("conversation:write") || ctx.can("contact:write"),
  body: (ctx) => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              <>A patient who opted out never receives campaigns or marketing templates, with no exceptions. You can still reply within
                24 hours of their last message, and send patient-care templates.</>,
              <>المريض الذي ألغى الاشتراك لا تصله الحملات ولا القوالب التسويقية أبداً. ويمكنك الرد عليه خلال 24 ساعة من آخر رسالة له،
                وإرسال قوالب رعاية المرضى.</>,
            )}
          </Lead>
          <Shot name="chat-opted-out" alt={t("A chat with the opt-out banner", "محادثة عليها شريط إلغاء الاشتراك")} />
          <H>{t("How a patient opts out or back in", "كيف يلغي المريض الاشتراك أو يعود إليه")}</H>
          <Table
            head={[
              t("Patient sends (the whole message, “please” / “من فضلك” allowed)", "يرسل المريض (الرسالة كاملة، ويُقبل معها “please” / “من فضلك”)"),
              t("Effect", "النتيجة"),
            ]}
            rows={[
              [<b key="s">STOP, UNSUBSCRIBE, Stop promotions · توقف، إيقاف، إلغاء الاشتراك، لا أريد رسائل</b>, t(
                "Opted out of marketing on this line. They get a short confirmation in their language.",
                "يُلغى اشتراكه في الرسائل التسويقية على هذا الرقم، ويصله تأكيد قصير بلغته.",
              )],
              [<b key="a">STOPALL, STOP ALL · أوقف الكل، إيقاف الكل</b>, t(
                "Opted out of marketing on every line.",
                "يُلغى اشتراكه في الرسائل التسويقية على كل الأرقام.",
              )],
              [<b key="t">START, SUBSCRIBE, RESUME · اشتراك، ابدأ، تفعيل</b>, t(
                "Lifts only the opt-outs they made themselves (on this line, and a STOP ALL), and confirms it.",
                "يلغي فقط ما أوقفه المريض بنفسه (على هذا الرقم، و STOP ALL)، ويصله تأكيد.",
              )],
              [t("WhatsApp's own “Stop promotions”", "زر “إيقاف العروض” في واتساب نفسه"), t(
                "Honoured like STOP — straight away, or at the latest on the next send (error 131050).",
                "يُعامل مثل STOP — فوراً، أو على الأكثر عند الإرسال التالي (الخطأ 131050).",
              )],
              [<b key="c">Cancel · إلغاء ({t("alone", "وحدها")})</b>, t(
                "Not an opt-out — at a clinic it usually means an appointment.",
                "ليست إلغاء اشتراك — في العيادة تعني غالباً إلغاء موعد.",
              )],
            ]}
          />
          <Callout tone="note">
            {t(
              <>CANCEL, END and QUIT are deliberately <b>not</b> opt-out words. Patients use them in everyday messages.</>,
              <>كلمات CANCEL و END و QUIT <b>ليست</b> كلمات إلغاء اشتراك عن قصد، لأن المرضى يستخدمونها في رسائلهم العادية.</>,
            )}
          </Callout>
          <H>{t("Recording an opt-out yourself", "تسجيل إلغاء الاشتراك بنفسك")}</H>
          <Steps
            items={[
              t(
                <>Click the <Ui>Follow up</Ui> chip in the chat header and choose <Ui>Opt out of marketing…</Ui>.</>,
                <>اضغط على <Ui>Follow up</Ui> أعلى المحادثة واختر <Ui>Opt out of marketing…</Ui>.</>,
              ),
              t(
                <>Pick <Ui>This line only</Ui> or <Ui>All lines (do not contact)</Ui>, and add a reason if you like.</>,
                <>اختر <Ui>This line only</Ui> (هذا الرقم فقط) أو <Ui>All lines (do not contact)</Ui> (كل الأرقام)، وأضف السبب إن
                  أردت.</>,
              ),
              t(
                <>Click <Ui>Opt out</Ui>. A banner on the chat shows the opt-out from then on.</>,
                <>اضغط <Ui>Opt out</Ui>. سيظهر شريط على المحادثة يوضح إلغاء الاشتراك من الآن.</>,
              ),
            ]}
          />
          <P>
            {t(
              <>Opt-outs are remembered <b>by phone number</b>. A deleted contact who comes back (re-imported, or writing in again) is
                still opted out.</>,
              <>يُحفظ إلغاء الاشتراك <b>برقم الهاتف</b>. إذا حُذف المريض ثم عاد (بالاستيراد أو بمراسلتنا من جديد) يبقى اشتراكه ملغى.</>,
            )}
          </P>
          {ctx.can("optout:lift") ? (
            <Callout tone="warn" title={t("Lifting an opt-out (admins)", "إعادة الاشتراك (لمديري النظام)")}>
              {t(
                <>Use <Ui>Lift opt-out…</Ui> in the same menu, or the Marketing toggle on the contact. If the patient opted out
                  themselves, the button reads <Ui>Lift anyway</Ui>. Only do it when the patient clearly asked.</>,
                <>استخدم <Ui>Lift opt-out…</Ui> من نفس القائمة، أو مفتاح Marketing في ملف المريض. إذا كان المريض قد ألغى الاشتراك
                  بنفسه يظهر الزر <Ui>Lift anyway</Ui>. لا تفعل ذلك إلا إذا طلب المريض صراحةً.</>,
              )}
            </Callout>
          ) : (
            <P>{t("Only an admin can lift an opt-out.", "مدير النظام فقط يمكنه إعادة الاشتراك.")}</P>
          )}
        </>
      )}
    </Bilingual>
  ),
};

const alerts: DocPage = {
  key: "alerts",
  label: "Hand-off alerts",
  group: GROUP,
  icon: Bell,
  description: "The alert cards: hand-offs and follow-ups",
  keywords: "notification alert card chime desktop handoff flow follow-up تنبيهات",
  visible: inboxUser,
  body: () => (
    <Bilingual>
      {(t) => (
        <>
          <Lead>
            {t(
              <>When a campaign flow needs a person, or a follow-up is due, a card appears in the bottom-right corner with a chime. Up to
                five are shown at a time, and they stay until you dismiss them.</>,
              <>عندما يحتاج رد آلي (Flow) إلى موظف، أو يحين موعد متابعة، تظهر بطاقة في الزاوية السفلية اليمنى مع صوت تنبيه. تظهر حتى
                خمس بطاقات معاً، وتبقى حتى تغلقها.</>,
            )}
          </Lead>
          <Table
            head={[t("Card", "البطاقة"), t("Means", "المعنى")]}
            rows={[
              [<b key="1">“Name wants to talk to an agent”</b>, t("A flow handed the patient over.", "الرد الآلي حوّل المريض إلى موظف.")],
              [<b key="5">“Follow up now · Name”</b>, t("A follow-up you set is due.", "حان موعد متابعة وضعتها.")],
            ]}
          />
          <P>
            {t(
              <>An assigned chat&apos;s alerts go only to its owner. Unassigned ones say <b>Waiting in Unassigned</b>. Alerts from
                another line offer <Ui>Switch line & open chat</Ui>. Click <Ui>Enable desktop alerts</Ui> to get them even when the tab
                is in the background.</>,
              <>تنبيهات المحادثة المُسندة تصل لصاحبها فقط، وغير المُسندة يظهر فيها <b>Waiting in Unassigned</b>. وتنبيهات رقم آخر
                فيها زر <Ui>Switch line & open chat</Ui> للانتقال إليه. اضغط <Ui>Enable desktop alerts</Ui> لتصلك التنبيهات حتى
                عندما تكون الصفحة في الخلفية.</>,
            )}
          </P>
        </>
      )}
    </Bilingual>
  ),
};

export const inboxPages: DocPage[] = [inbox, chatting, windowPage, ownership, outcomes, contactPanel, optOuts, alerts];
