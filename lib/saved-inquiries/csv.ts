import type { SavedInquiryExportRow } from "@/lib/api-contract";

const BOM = "\uFEFF";

const HEADERS = [
  "Inquiry ID",
  "Saved At",
  "Customer Name",
  "Company Name",
  "General Notes",
  "Currency",
  "Product Code",
  "Product Name",
  "Quoted Unit Price",
  "Product Notes",
] as const;

export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function savedInquiryExportFilename(now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `saved-inquiries-${year}-${month}-${day}.csv`;
}

export function buildSavedInquiryCsv(rows: SavedInquiryExportRow[]): string {
  const lines = [
    HEADERS.join(","),
    ...rows.map((row) =>
      [
        csvField(row.inquiryId),
        csvField(row.savedAt),
        csvField(row.customerName),
        csvField(row.companyName),
        csvField(row.generalNotes),
        csvField(row.currency),
        csvField(row.productCode),
        csvField(row.productName),
        csvField(row.quotedUnitPrice),
        csvField(row.productNotes),
      ].join(","),
    ),
  ];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
