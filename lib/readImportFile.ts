// Reads a contacts file picked for import — .csv or Excel .xlsx — into the
// header row + data rows the column-mapping screen works on. Excel files are
// read in the browser (first sheet only) and from then on follow the same path
// as a CSV, so the server only ever receives the mapped CSV.

import { parseCSVRows } from "@/lib/customerImport";

export const IMPORT_ACCEPT = ".csv,.xlsx";

export class ImportFileError extends Error {}

const pad = (n: number) => String(n).padStart(2, "0");

// One cell as the text a CSV would have held.
function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // Excel dates come back as UTC midnight; YYYY-MM-DD reads unambiguously.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  // Long phone numbers are stored as numbers; never let them turn into 2.01e+11.
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if ("result" in o) return cellText(o.result); // formula
    if (o.text != null) return cellText(o.text); // hyperlink
    if (o.error) return "";
  }
  return String(v).trim();
}

async function readXlsx(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const mod = await import("exceljs");
  // exceljs is CommonJS: the classes sit on the default export or the namespace depending on the bundler.
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const width = ws.columnCount;
  const table: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value).trim());
    if (cells.some((x) => x)) table.push(cells);
  });
  if (!table.length) return { headers: [], rows: [] };
  return { headers: table[0], rows: table.slice(1) };
}

export async function readImportFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return readXlsx(file);
  if (name.endsWith(".xls")) {
    throw new ImportFileError("Old .xls files can't be read — in Excel use File › Save As › Excel Workbook (.xlsx) or CSV.");
  }
  return parseCSVRows(await file.text());
}
