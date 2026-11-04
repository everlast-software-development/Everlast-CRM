// Offer wording that makes a template marketing — the same list as the API's
// utils/marketingWords.js, which is what actually refuses it. Here it only
// warns while typing on the Patient messages page. Keep the two in step.

const EN = [
  "offer", "offers", "discount", "discounts", "sale", "sales", "promo", "promotion", "promotions",
  "deal", "deals", "coupon", "voucher", "for free", "free consultation", "free session", "free of charge",
  "gift", "cashback", "bonus", "savings",
  "% off", "off on", "limited time", "limited offer", "special price", "special offer", "best price",
  "lowest price", "exclusive", "flash sale", "black friday", "anniversary", "celebrate", "hurry",
  "don't miss", "dont miss", "last chance", "book now and", "buy", "package", "packages",
];
const AR = [
  "عرض", "عروض", "خصم", "خصومات", "تخفيض", "تخفيضات", "مجان", "هدية", "هدايا", "كوبون", "قسيمة",
  "لفترة محدودة", "سعر خاص", "أفضل سعر", "اقل سعر", "أقل سعر", "حصري", "باقة", "باقات", "احتفال",
  "لا تفوت", "فرصة", "توفير", "وفر",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EN_RE: [string, RegExp][] = EN.map((w) => [w, new RegExp(`(^|[^a-z])${escape(w)}(?=$|[^a-z])`, "i")]);

/** The offer words found in `text`, [] when none. */
export function findMarketingWords(text: string): string[] {
  const t = String(text || "").replace(/\{\{[^{}]*\}\}/g, " ");
  const found = new Set<string>();
  for (const [w, re] of EN_RE) if (re.test(t)) found.add(w);
  for (const w of AR) if (t.includes(w)) found.add(w);
  if (/\d\s*[%٪]|[%٪]\s*\d/.test(t)) found.add("%");
  return [...found];
}
