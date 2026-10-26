// Shared helpers for the CSV contact importer (used by the /customers/import flow).
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface ImportField {
  key: string;
  label: string;
  csv: string;
  required?: boolean;
  aliases: string[];
}

export interface MappingData {
  headers: string[];
  rows: string[][];
  fileName: string;
}

export interface ImportIssue {
  row: number;
  phone?: string;
  reason: string;
}

// Dry-run validation result (no rows written).
export interface ValidateResult {
  total: number;
  valid: number;
  duplicates: ImportIssue[];
  invalid: ImportIssue[];
}

// Actual import result.
export interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  duplicates?: ImportIssue[];
  errors: ImportIssue[];
}

export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "dmy", label: "Day first — DD/MM/YYYY" },
  { value: "mdy", label: "Month first — MM/DD/YYYY" },
  { value: "ymd", label: "Year first — YYYY-MM-DD" },
];

// ─── Phone ────────────────────────────────────────────────────────────────────

export function normalizePhone(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 12) return "20" + digits.slice(1);
  return digits;
}

export function isValidPhone(normalized: string): boolean {
  return /^\d{7,15}$/.test(normalized);
}

export type PhoneCountry = CountryCode | "auto";

// "Auto-detect" reads the country from each number's own code (works worldwide).
// The specific countries are the fallback for local numbers that carry no code.
export const COUNTRY_OPTIONS: { value: PhoneCountry; label: string }[] = [
  { value: "auto", label: "🌐 Auto-detect (UAE, then Egypt, for local numbers)" },
  { value: "AE", label: "🇦🇪 UAE (+971)" },
  { value: "EG", label: "🇪🇬 Egypt (+20)" },
  { value: "SA", label: "🇸🇦 Saudi Arabia (+966)" },
  { value: "KW", label: "🇰🇼 Kuwait (+965)" },
  { value: "QA", label: "🇶🇦 Qatar (+974)" },
  { value: "BH", label: "🇧🇭 Bahrain (+973)" },
  { value: "OM", label: "🇴🇲 Oman (+968)" },
];

export type PhoneCheck = { valid: boolean; formatted: string; reason?: string };

// Validate/format a phone the same way the backend does (normalizeImportPhone
// in modules/customers/import.utils.js), for the live preview:
//   1. With its own code ("+20…", "0020…", or the bare digits "20122…") it is
//      read as international — any country, the whole Arab world included.
//   2. Otherwise it is a local number: tried as the chosen country first, then
//      UAE, then Egypt.
// Only mobiles pass — a landline can't receive WhatsApp.
const LOCAL_FALLBACK: CountryCode[] = ["AE", "EG"];

function readMobile(text: string, country?: CountryCode) {
  try {
    const pn = parsePhoneNumberFromString(text, country);
    return pn && pn.isValid() ? pn : null;
  } catch {
    return null;
  }
}

export function checkPhone(raw: string, country: PhoneCountry): PhoneCheck {
  const s = (raw ?? "").trim();
  if (!s) return { valid: false, formatted: "", reason: "Missing" };
  const intl = s.replace(/^00/, "+"); // a leading 00 is the international prefix
  const digits = intl.replace(/\D/g, "");
  let pn = intl.startsWith("+") ? readMobile("+" + digits) : null;
  // International digits without the "+" (10+ digits, no leading 0).
  if (!pn && /^[1-9]\d{9,14}$/.test(digits)) pn = readMobile("+" + digits);
  if (!pn) {
    const tryOrder = [...new Set([country === "auto" ? null : country, ...LOCAL_FALLBACK].filter((c): c is CountryCode => !!c))];
    for (const c of tryOrder) {
      pn = readMobile(intl, c);
      if (pn && pn.getType() !== "FIXED_LINE") break;
      pn = null;
    }
  }
  if (pn) {
    if (pn.getType() === "FIXED_LINE") return { valid: false, formatted: pn.number, reason: "Landline — can't receive WhatsApp" };
    return { valid: true, formatted: pn.number };
  }
  return { valid: false, formatted: s, reason: "Not a valid / messageable number" };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

export function parseCSVLine(line: string): string[] {
  const vals: string[] = [];
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      vals.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  vals.push(cur);
  return vals.map((v) => v.trim().replace(/^"|"$/g, ""));
}

// Parse CSV preserving original header casing/order for the column-mapping UI.
export function parseCSVRows(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(parseCSVLine);
  return { headers, rows };
}

// ─── Fields & auto-mapping ──────────────────────────────────────────────────

export const IMPORT_FIELDS: ImportField[] = [
  { key: "chart_number", label: "Chart Number", csv: "chart_number", aliases: ["chartnumber", "chart", "chartno", "chartid", "mrn", "medicalrecord", "recordnumber", "file", "fileno", "filenumber"] },
  { key: "name", label: "Full Name", csv: "name", aliases: ["name", "fullname", "patientname", "customername", "patient", "client"] },
  { key: "phone", label: "Mobile", csv: "phone", required: true, aliases: ["phone", "mobile", "mobilenumber", "phonenumber", "cell", "cellphone", "whatsapp", "contact", "tel", "telephone", "number"] },
  { key: "email", label: "Email", csv: "email", aliases: ["email", "emailaddress", "mail", "e-mail"] },
  { key: "nationality", label: "Nationality", csv: "nationality", aliases: ["nationality", "nation", "country", "citizenship"] },
  { key: "gender", label: "Gender", csv: "gender", aliases: ["gender", "sex"] },
  { key: "date_of_birth", label: "Date of Birth", csv: "date_of_birth", aliases: ["dateofbirth", "dob", "birthdate", "birthday", "birth"] },
  { key: "join_date", label: "Join Date", csv: "join_date", aliases: ["joindate", "datejoined", "registrationdate", "membersince", "registered", "enrolled", "enrollmentdate"] },
  { key: "departments", label: "Departments", csv: "departments", aliases: ["departments", "department", "dept", "depts", "service", "services", "treatment", "treatments"] },
  { key: "tags", label: "Tags", csv: "tags", aliases: ["tags", "tag", "labels", "label", "segment"] },
  { key: "notes", label: "Notes", csv: "notes", aliases: ["notes", "note", "comment", "comments", "remark", "remarks"] },
];

// Date fields need flexible parsing / a format hint.
export const DATE_FIELD_KEYS = ["date_of_birth", "join_date"];

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function autoMapHeaders(headers: string[]): Record<string, number> {
  const norm = headers.map(normalizeHeader);
  const mapping: Record<string, number> = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    let idx = norm.findIndex((h, i) => !used.has(i) && field.aliases.includes(h));
    if (idx === -1) idx = norm.findIndex((h, i) => !used.has(i) && field.aliases.some((a) => h.includes(a) || a.includes(h)));
    mapping[field.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

export function guessGender(value: string): "Male" | "Female" | "" {
  const s = value.trim().toLowerCase();
  if (["male", "m", "man", "men", "boy", "mr", "ذكر"].includes(s)) return "Male";
  if (["female", "f", "woman", "women", "girl", "mrs", "ms", "miss", "أنثى", "انثى"].includes(s)) return "Female";
  return "";
}

// ─── Flexible date parsing ─────────────────────────────────────────────────
// Returns a Date, null (empty), or undefined (unparseable). Kept in sync with
// the identical parser in the backend importer.

function buildDate(y: number, mo: number, d: number): Date | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return dt;
}

export function parseFlexibleDate(value: string, format: DateFormat = "auto"): Date | null | undefined {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  // Year-first: 2024-05-14 / 2024.5.14 / 2024/05/14
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return buildDate(+m[1], +m[2], +m[3]);

  // Two-part-then-year with separators: 14/05/1990, 05-14-90, 14.05.1990
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    let day: number, month: number;
    if (format === "mdy") { month = a; day = b; }
    else if (format === "dmy") { day = a; month = b; }
    else {
      // auto / ymd fallback: disambiguate by value, else prefer day-first
      if (a > 12 && b <= 12) { day = a; month = b; }
      else if (b > 12 && a <= 12) { month = a; day = b; }
      else { day = a; month = b; }
    }
    return buildDate(y, month, day);
  }

  // Fallback: month-name formats ("14 May 1990", "May 14, 1990"). Rebuild at
  // UTC midnight from the local components so the calendar day never shifts.
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  return undefined;
}

export function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Build canonical CSV for the backend ────────────────────────────────────
// Phone is normalized and gender translated here; dates are sent raw (the
// backend parses them with the chosen dateFormat so it can report bad ones).

export function buildMappedCSV(
  headers: string[],
  rows: string[][],
  mapping: Record<string, number>,
  valueMaps: Record<string, Record<string, string>> = {}
): string {
  const fields = IMPORT_FIELDS.filter((f) => mapping[f.key] >= 0);
  const headerLine = fields.map((f) => f.csv).join(",");
  const dataLines = rows.map((row) =>
    fields
      .map((f) => {
        const raw = row[mapping[f.key]] ?? "";
        let val = raw;
        // Phone is sent raw — the backend validates & formats it to the
        // messageable international format using the chosen default country.
        if (f.key === "gender") val = valueMaps.gender?.[raw.trim()] ?? "";
        else if (f.key === "phone") val = raw.trim();
        return csvEscape(val);
      })
      .join(",")
  );
  return [headerLine, ...dataLines].join("\n");
}
