import {
  SAVED_INQUIRY_DATE_PATTERN,
  SAVED_INQUIRY_MAX_PAGE_SIZE,
  SAVED_INQUIRY_MAX_QUERY_LENGTH,
  SAVED_INQUIRY_PAGE_SIZE,
  SAVED_INQUIRY_UUID_PATTERN,
} from "./constants";

export interface SavedInquiryListQuery {
  q: string;
  from: string | null;
  to: string | null;
  fromIso: string | null;
  toExclusiveIso: string | null;
  page: number;
  pageSize: number;
}

export type SavedInquiryQueryResult =
  | { ok: true; value: SavedInquiryListQuery }
  | { ok: false; errors: string[] };

function readParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

function parsePositiveInt(raw: string, fallback: number): number | null {
  if (raw === "") return fallback;
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

function isValidDay(value: string): boolean {
  const match = SAVED_INQUIRY_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dayStartUtc(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function nextDayStartUtc(value: string): string {
  const match = SAVED_INQUIRY_DATE_PATTERN.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export function parseSavedInquiryListQuery(
  params: URLSearchParams,
): SavedInquiryQueryResult {
  const errors: string[] = [];
  const q = readParam(params, "q");
  if (q.length > SAVED_INQUIRY_MAX_QUERY_LENGTH) {
    errors.push("Search is too long.");
  }

  const from = readParam(params, "from");
  const to = readParam(params, "to");
  if (from !== "" && !isValidDay(from)) errors.push("From date is not a valid day.");
  if (to !== "" && !isValidDay(to)) errors.push("To date is not a valid day.");
  if (from !== "" && to !== "" && isValidDay(from) && isValidDay(to) && from > to) {
    errors.push("From date cannot be after to date.");
  }

  const page = parsePositiveInt(readParam(params, "page"), 1);
  if (page === null) errors.push("Page must be a positive whole number.");

  const rawPageSize = readParam(params, "pageSize");
  let pageSize = SAVED_INQUIRY_PAGE_SIZE;
  if (rawPageSize !== "") {
    const parsed = parsePositiveInt(rawPageSize, SAVED_INQUIRY_PAGE_SIZE);
    if (parsed === null) {
      errors.push("Page size must be a positive whole number.");
    } else if (parsed > SAVED_INQUIRY_MAX_PAGE_SIZE) {
      errors.push(`Page size cannot exceed ${SAVED_INQUIRY_MAX_PAGE_SIZE}.`);
    } else {
      pageSize = parsed;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      q,
      from: from === "" ? null : from,
      to: to === "" ? null : to,
      fromIso: from === "" ? null : dayStartUtc(from),
      toExclusiveIso: to === "" ? null : nextDayStartUtc(to),
      page: page ?? 1,
      pageSize,
    },
  };
}

export function isSavedInquiryId(value: string): boolean {
  return SAVED_INQUIRY_UUID_PATTERN.test(value.trim());
}

export function savedInquiryListSearchParams(query: {
  q: string;
  from: string | null;
  to: string | null;
  page?: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  if (query.q.trim() !== "") params.set("q", query.q.trim());
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page && query.page !== 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== SAVED_INQUIRY_PAGE_SIZE) {
    params.set("pageSize", String(query.pageSize));
  }
  return params.toString();
}
