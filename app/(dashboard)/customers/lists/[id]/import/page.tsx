"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { readImportFile, ImportFileError, IMPORT_ACCEPT } from "@/lib/readImportFile";
import { useParams, useRouter } from "next/navigation";
import {
  autoMapHeaders,
  guessGender,
  buildMappedCSV,
  checkPhone,
  parseFlexibleDate,
  formatDateISO,
  IMPORT_FIELDS,
  DATE_FIELD_KEYS,
  DATE_FORMAT_OPTIONS,
  COUNTRY_OPTIONS,
  type MappingData,
  type ImportField,
  type DateFormat,
  type PhoneCountry,
  type ValidateResult,
  type ImportIssue,
} from "@/lib/customerImport";
import { apiValidateListImport, apiImportListMembers, apiGetList } from "@/lib/api";

interface ListImportResult {
  total: number;
  created: number;
  matchedExisting: number;
  linked: number;
  alreadyInList: number;
  duplicatesInFile: number;
  errors: ImportIssue[];
}

const STEPS = [
  { n: 1, label: "Upload" },
  { n: 2, label: "Map columns" },
  { n: 3, label: "Validate" },
  { n: 4, label: "Import" },
];

// Small collapsible list of issues (invalid rows).
function IssueList({ issues, tone }: { issues: ImportIssue[]; tone: "amber" | "red" }) {
  const textColor = tone === "amber" ? "text-amber-600" : "text-red-600";
  return (
    <div className="mt-1 max-h-56 overflow-y-auto space-y-0.5 px-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
      {issues.map((e, i) => (
        <p key={i} className={`text-[11px] ${textColor} px-2 py-0.5`}>
          Row {e.row}{e.phone ? ` · ${e.phone}` : ""} — {e.reason}
        </p>
      ))}
    </div>
  );
}

export default function ImportListMembersPage() {
  const params = useParams();
  const router = useRouter();
  const listId = params.id as string;

  const [listName, setListName] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [data, setData] = useState<MappingData | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [valueMaps, setValueMaps] = useState<Record<string, Record<string, string>>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("auto");
  const [defaultCountry, setDefaultCountry] = useState<PhoneCountry>("auto");

  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ListImportResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Guards against a slow/stale validate or import response landing after a
  // newer one and silently overwriting it with outdated numbers.
  const validateSeqRef = useRef(0);
  const importSeqRef = useRef(0);

  useEffect(() => {
    apiGetList(listId, 1, 1).then((res) => setListName(res.data.name)).catch(() => {});
  }, [listId]);

  const phoneMapped = (mapping["phone"] ?? -1) >= 0;
  const mappedFields = data ? IMPORT_FIELDS.filter((f) => mapping[f.key] >= 0) : [];
  const preview = data ? data.rows.slice(0, 50) : [];
  const hasDateMapped = DATE_FIELD_KEYS.some((k) => (mapping[k] ?? -1) >= 0);

  // Distinct values in the mapped gender column.
  const genderCol = mapping["gender"] ?? -1;
  const distinctGenderValues = useMemo(() => {
    if (!data || genderCol < 0) return [];
    const set = new Set<string>();
    for (const row of data.rows) {
      const v = (row[genderCol] ?? "").trim();
      if (v) set.add(v);
      if (set.size > 100) break;
    }
    return [...set];
  }, [genderCol, data]);

  useEffect(() => {
    if (genderCol < 0) return;
    setValueMaps((prev) => ({ ...prev, gender: Object.fromEntries(distinctGenderValues.map((v) => [v, guessGender(v)])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genderCol]);

  // Split every row into new / already-in-contacts / invalid using the row
  // numbers the backend returned (row = index + 2, since row 1 is the header).
  const categories = useMemo(() => {
    if (!data || !validateResult) return null;
    const existingBy = new Map(validateResult.duplicates.map((d) => [d.row, d.reason]));
    const invBy = new Map(validateResult.invalid.map((e) => [e.row, e.reason]));
    const fresh: { i: number }[] = [];
    const existing: { i: number; reason: string }[] = [];
    const invalid: { i: number; reason: string }[] = [];
    data.rows.forEach((_, i) => {
      const rowNum = i + 2;
      if (invBy.has(rowNum)) invalid.push({ i, reason: invBy.get(rowNum)! });
      else if (existingBy.has(rowNum)) existing.push({ i, reason: existingBy.get(rowNum)! });
      else fresh.push({ i });
    });
    return { fresh, existing, invalid };
  }, [data, validateResult]);

  // How many rows will actually end up linked to the list (new + already existing).
  const willLink = validateResult ? validateResult.valid + validateResult.duplicates.length : 0;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const { headers, rows } = await readImportFile(file);
      if (headers.length === 0 || rows.length === 0) {
        setError("The file is empty or has no data rows.");
        setData(null);
        return;
      }
      setData({ headers, rows, fileName: file.name });
      setMapping(autoMapHeaders(headers));
      setValidateResult(null);
      setImportResult(null);
    } catch (err) {
      setError(err instanceof ImportFileError ? err.message : "Couldn't read that file.");
    } finally {
      setParsing(false);
    }
  }

  function cellNode(f: ImportField, row: string[]) {
    const raw = row[mapping[f.key]] ?? "";
    if (!raw.trim()) return <span className="text-gray-300">—</span>;
    if (f.key === "gender") {
      const g = valueMaps.gender?.[raw.trim()] ?? "";
      return g ? <>{g}</> : <span className="text-amber-500" title="Not mapped — will import blank">{raw} ⚠</span>;
    }
    if (f.key === "phone") {
      const chk = checkPhone(raw, defaultCountry);
      if (!chk.valid) return <span className="text-red-500" title={chk.reason}>{raw} ⚠</span>;
      return <>{chk.formatted}</>;
    }
    if (DATE_FIELD_KEYS.includes(f.key)) {
      const d = parseFlexibleDate(raw, dateFormat);
      if (d === undefined) return <span className="text-red-500" title="Unrecognized date — pick a date format below">{raw} ⚠</span>;
      if (d === null) return <span className="text-gray-300">—</span>;
      return <>{formatDateISO(d)}</>;
    }
    return <>{raw}</>;
  }

  // Collapsible table of a category's rows, showing every mapped field.
  const TONES = {
    green: { border: "border-green-100", bg: "bg-green-50", dot: "bg-green-500", text: "text-green-700", chev: "text-green-400" },
    amber: { border: "border-amber-100", bg: "bg-amber-50", dot: "bg-amber-500", text: "text-amber-700", chev: "text-amber-400" },
    red: { border: "border-red-100", bg: "bg-red-50", dot: "bg-red-500", text: "text-red-700", chev: "text-red-400" },
  };
  function categoryTable(opts: {
    label: string;
    tone: "green" | "amber" | "red";
    entries: { i: number; reason?: string }[];
    showReason?: boolean;
    open?: boolean;
  }) {
    const CAP = 200;
    const rows = data?.rows ?? [];
    const shown = opts.entries.slice(0, CAP);
    const t = TONES[opts.tone];
    return (
      <details open={opts.open} className={`group border ${t.border} rounded-xl overflow-hidden`}>
        <summary className={`flex items-center gap-2.5 p-3 ${t.bg} cursor-pointer list-none`}>
          <span className={`w-2 h-2 rounded-full ${t.dot} shrink-0`} />
          <span className={`text-[13px] font-semibold ${t.text} flex-1`}>{opts.entries.length.toLocaleString()} {opts.label}</span>
          <svg className={`w-3.5 h-3.5 ${t.chev} group-open:rotate-180 transition-transform`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
        </summary>
        {opts.entries.length === 0 ? (
          <p className="text-[12px] text-gray-400 px-3 py-3 border-t border-gray-100">None.</p>
        ) : (
          <div className="overflow-x-auto border-t border-gray-100 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Row</th>
                  {mappedFields.map((f) => (
                    <th key={f.key} className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap">{f.label}</th>
                  ))}
                  {opts.showReason && <th className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap">Reason</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.i} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2 text-[11px] text-gray-400">{e.i + 2}</td>
                    {mappedFields.map((f) => (
                      <td key={f.key} className="px-3 py-2">
                        <span className="block text-[12px] text-gray-700 max-w-[180px] truncate">{cellNode(f, rows[e.i])}</span>
                      </td>
                    ))}
                    {opts.showReason && (
                      <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[11px] font-medium ${t.text}`}>{e.reason}</span></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {opts.entries.length > CAP && (
              <p className="text-[11px] text-gray-400 px-3 py-2 border-t border-gray-50">Showing first {CAP} of {opts.entries.length.toLocaleString()}.</p>
            )}
          </div>
        )}
      </details>
    );
  }

  async function runValidate() {
    if (!data) return;
    const seq = ++validateSeqRef.current;
    setStep(3);
    setValidating(true);
    setValidateResult(null);
    setError(null);
    try {
      const csv = buildMappedCSV(data.headers, data.rows, mapping, valueMaps);
      const file = new File([csv], "import.csv", { type: "text/csv" });
      const res = await apiValidateListImport(listId, file, dateFormat, defaultCountry);
      if (seq !== validateSeqRef.current) return; // a newer validate superseded this one
      setValidateResult(res.data);
    } catch (err) {
      if (seq !== validateSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      if (seq === validateSeqRef.current) setValidating(false);
    }
  }

  async function runImport() {
    if (!data) return;
    const seq = ++importSeqRef.current;
    setStep(4);
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const csv = buildMappedCSV(data.headers, data.rows, mapping, valueMaps);
      const file = new File([csv], "import.csv", { type: "text/csv" });
      const res = await apiImportListMembers(listId, file, dateFormat, defaultCountry);
      if (seq !== importSeqRef.current) return; // a newer import superseded this one
      setImportResult(res.data);
    } catch (err) {
      if (seq !== importSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      if (seq === importSeqRef.current) setImporting(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-white font-[family-name:var(--font-geist-sans)]">
      {/* Header + stepper */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-gray-900 tracking-tight">
              Import contacts into {listName ? <span className="text-brand-fg">&quot;{listName}&quot;</span> : "list"}
            </h1>
            <p className="text-[13px] text-gray-400 mt-0.5">
              Upload a spreadsheet, map the columns, validate, then import. Contacts that already exist won&apos;t be duplicated — they&apos;ll just be linked to this list.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/customers/lists/${listId}`)}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 hover:text-gray-700 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            Close
          </button>
        </div>
        {/* Stepper */}
        <div className="flex items-center gap-2 mt-5 max-w-2xl">
          {STEPS.map((s, i) => {
            const done = step > s.n;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${done || active ? "bg-brand text-white" : "bg-gray-100 text-gray-400"}`}>
                  {done ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : s.n}
                </div>
                <span className={`text-[12px] font-semibold shrink-0 ${done || active ? "text-gray-900" : "text-gray-400"}`}>{s.label}</span>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200 min-w-[16px]" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="w-full">

          {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                onClick={() => fileRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 py-14 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${dragOver ? "border-brand bg-brand-100" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
              >
                {parsing ? (
                  <>
                    <svg className="w-7 h-7 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <p className="text-[14px] font-semibold text-gray-700">Reading your file…</p>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-2xl bg-brand-200 flex items-center justify-center">
                      <svg className="w-6 h-6 text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </div>
                    <p className="text-[14px] font-semibold text-gray-700">Drop your CSV or Excel file here, or click to browse</p>
                    <p className="text-[12px] text-gray-400">Up to 20,000 rows · .csv or .xlsx</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>

              {data && !parsing && (
                <div className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="w-11 h-11 rounded-xl bg-brand-200 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-gray-900 truncate">{data.fileName}</p>
                    <p className="text-[12px] text-gray-400">{data.rows.length.toLocaleString()} rows · {data.headers.length} columns detected</p>
                  </div>
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-[12px] font-semibold text-brand-fg hover:underline cursor-pointer shrink-0">Change file</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Map columns ────────────────────────────────────────── */}
          {step === 2 && data && (
            <div className="space-y-6">
              {/* Field mapping */}
              <div>
                <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider mb-3">Match fields to your columns</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {IMPORT_FIELDS.map((f) => {
                    const missing = f.required && mapping[f.key] < 0;
                    return (
                      <div key={f.key} className="flex items-center gap-3">
                        <label className="text-[13px] font-medium text-gray-700 w-28 shrink-0">
                          {f.label}{f.required && <span className="text-red-500"> *</span>}
                        </label>
                        <div className="relative flex-1">
                          <select
                            value={mapping[f.key]}
                            onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                            className={`w-full text-[13px] rounded-lg border px-2.5 py-2 pr-7 outline-none cursor-pointer bg-white appearance-none transition-colors ${missing ? "border-red-300 bg-red-50" : "border-gray-200"} focus:ring-2 focus:ring-brand/20 focus:border-brand`}
                          >
                            <option value={-1}>— Skip —</option>
                            {data.headers.map((h, i) => (
                              <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                            ))}
                          </select>
                          <svg className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Phone country (for numbers stored without a country code) */}
              {phoneMapped && (
                <div>
                  <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider mb-1">Mobile country</p>
                  <p className="text-[12px] text-gray-400 mb-3">Numbers that carry their own country code (<span className="font-mono">+971…</span>, <span className="font-mono">+20…</span>) are auto-detected — any country. Numbers with no code are assumed to be the country below (defaults to <span className="font-semibold">UAE</span>). Invalid / unmessageable numbers are flagged in the next step.</p>
                  <div className="relative w-72">
                    <select
                      value={defaultCountry}
                      onChange={(e) => setDefaultCountry(e.target.value as PhoneCountry)}
                      className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 pr-7 outline-none cursor-pointer bg-white appearance-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    >
                      {COUNTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <svg className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              )}

              {/* Date format */}
              {hasDateMapped && (
                <div>
                  <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider mb-1">Date format</p>
                  <p className="text-[12px] text-gray-400 mb-3">How should dates in your file be read? Watch the preview — a red ⚠ means a value couldn&apos;t be parsed.</p>
                  <div className="relative w-64">
                    <select
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                      className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-2 pr-7 outline-none cursor-pointer bg-white appearance-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    >
                      {DATE_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <svg className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              )}

              {/* Gender values */}
              {genderCol >= 0 && distinctGenderValues.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider mb-1">Gender values</p>
                  <p className="text-[12px] text-gray-400 mb-3">Map each value found to Male or Female. Anything left as “Don’t import” is saved blank.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {distinctGenderValues.slice(0, 30).map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-[12px] text-gray-700 flex-1 truncate font-mono bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100">{v}</span>
                        <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        <div className="relative w-32 shrink-0">
                          <select
                            value={valueMaps.gender?.[v] ?? ""}
                            onChange={(e) => setValueMaps((prev) => ({ ...prev, gender: { ...(prev.gender ?? {}), [v]: e.target.value } }))}
                            className="w-full text-[13px] rounded-lg border border-gray-200 px-2.5 py-1.5 pr-7 outline-none cursor-pointer bg-white appearance-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                          >
                            <option value="">Don’t import</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                          <svg className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-bold text-gray-900 uppercase tracking-wider">Live preview</p>
                  <p className="text-[11px] text-gray-400">First {preview.length} of {data.rows.length.toLocaleString()} rows</p>
                </div>
                {mappedFields.length === 0 ? (
                  <p className="text-[13px] text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl">Map at least one field to preview your data.</p>
                ) : (
                  <div className="overflow-auto max-h-[440px] border border-gray-100 rounded-xl [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          {mappedFields.map((f) => (
                            <th key={f.key} className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap">
                              {f.label}{f.required && <span className="text-red-400"> *</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, ri) => (
                          <tr key={ri} className="border-b border-gray-50 last:border-0">
                            {mappedFields.map((f) => (
                              <td key={f.key} className="px-3 py-2">
                                <span className="block text-[12px] text-gray-700 max-w-[200px] truncate">{cellNode(f, row)}</span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Validate ───────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              {validating ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
                  <svg className="w-7 h-7 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  <p className="text-[14px] font-semibold text-gray-700">Checking {data?.rows.length.toLocaleString()} rows…</p>
                  <p className="text-[12px] text-gray-400">Matching against your existing contacts</p>
                </div>
              ) : validateResult ? (
                <>
                  {/* Summary tiles */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-green-50 border border-green-100 text-center">
                      <p className="text-[24px] font-bold text-green-700">{validateResult.valid.toLocaleString()}</p>
                      <p className="text-[12px] font-semibold text-green-600 mt-0.5">New contacts</p>
                    </div>
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-center">
                      <p className="text-[24px] font-bold text-amber-700">{validateResult.duplicates.length.toLocaleString()}</p>
                      <p className="text-[12px] font-semibold text-amber-600 mt-0.5">Already in Contacts</p>
                    </div>
                    <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-center">
                      <p className="text-[24px] font-bold text-red-700">{validateResult.invalid.length.toLocaleString()}</p>
                      <p className="text-[12px] font-semibold text-red-600 mt-0.5">Invalid</p>
                    </div>
                  </div>
                  <p className="text-[12px] text-gray-400 text-center">
                    {validateResult.total.toLocaleString()} rows checked. {willLink.toLocaleString()} contact{willLink !== 1 ? "s" : ""} will be linked to this list — new ones are created, existing ones are reused (never duplicated).
                  </p>

                  {/* Full field tables per category */}
                  {categories && (
                    <div className="space-y-3">
                      {categoryTable({ label: "new contacts", tone: "green", entries: categories.fresh, open: true })}
                      {categoryTable({ label: "already in Contacts — will be linked, not duplicated", tone: "amber", entries: categories.existing, showReason: true, open: true })}
                      {categoryTable({ label: "invalid — will be skipped", tone: "red", entries: categories.invalid, showReason: true, open: true })}
                    </div>
                  )}
                  {validateResult.invalid.length > 0 && (
                    <p className="text-[12px] text-gray-500 text-center">
                      Seeing date errors? Go back and pick the right <span className="font-semibold">date format</span>, then re-validate.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-gray-400 text-center py-10">{error || "No validation run yet."}</p>
              )}
            </div>
          )}

          {/* ── Step 4: Import ─────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              {importing ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
                  <svg className="w-7 h-7 animate-spin text-brand-fg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  <p className="text-[14px] font-semibold text-gray-700">Importing…</p>
                </div>
              ) : importResult ? (
                <>
                  <div className="flex flex-col items-center gap-2 py-4">
                    <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    </div>
                    <p className="text-[16px] font-bold text-gray-900">{importResult.linked.toLocaleString()} contacts added to the list</p>
                    <p className="text-[12px] text-gray-400">
                      {importResult.created.toLocaleString()} new · {importResult.matchedExisting.toLocaleString()} already in Contacts
                      {importResult.alreadyInList > 0 ? ` · ${importResult.alreadyInList.toLocaleString()} already in this list` : ""}
                      {importResult.errors.length > 0 ? ` · ${importResult.errors.length.toLocaleString()} invalid` : ""}
                    </p>
                  </div>
                  {importResult.errors.length > 0 && (
                    <details className="group border border-red-100 rounded-xl overflow-hidden">
                      <summary className="flex items-center gap-3 p-3 bg-red-50 cursor-pointer list-none">
                        <span className="text-[13px] font-semibold text-red-600 flex-1">{importResult.errors.length.toLocaleString()} invalid rows</span>
                        <svg className="w-3.5 h-3.5 text-red-400 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6"/></svg>
                      </summary>
                      <IssueList issues={importResult.errors} tone="red" />
                    </details>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-red-500 text-center py-10">{error || "Import didn't run."}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-red-500 min-h-[16px]">
          {error || (step === 2 && !phoneMapped ? "Map the Mobile column — it's required." : "")}
        </p>
        <div className="flex gap-3 shrink-0">
          {step === 1 && (
            <>
              <button type="button" onClick={() => router.push(`/customers/lists/${listId}`)} className="py-2.5 px-4 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={() => setStep(2)} disabled={!data || parsing} className="py-2.5 px-4 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer">Next: Map columns →</button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" onClick={() => setStep(1)} className="py-2.5 px-4 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">← Back</button>
              <button type="button" onClick={runValidate} disabled={!phoneMapped} className="py-2.5 px-4 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer">Next: Validate →</button>
            </>
          )}
          {step === 3 && (
            <>
              <button type="button" onClick={() => { setStep(2); setValidateResult(null); setError(null); }} disabled={validating} className="py-2.5 px-4 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors cursor-pointer">← Back</button>
              <button type="button" onClick={runImport} disabled={validating || !validateResult || willLink === 0} className="py-2.5 px-4 rounded-xl bg-brand hover:bg-[#2f5840] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold text-white transition-colors cursor-pointer">
                Add {willLink.toLocaleString()} contact{willLink !== 1 ? "s" : ""} to list
              </button>
            </>
          )}
          {step === 4 && importResult && (
            <>
              <button type="button" onClick={() => router.push("/customers/lists")} className="py-2.5 px-4 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer">
                Back to Lists
              </button>
              <button type="button" onClick={() => router.push(`/customers/lists/${listId}`)} className="py-2.5 px-5 rounded-xl bg-brand hover:bg-[#2f5840] text-[13px] font-semibold text-white transition-colors cursor-pointer">
                View list
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
