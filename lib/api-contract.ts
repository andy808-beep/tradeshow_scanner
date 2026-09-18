import { DEFAULT_CURRENCY } from "./format";
import type { Product } from "./types";

/** Only one currency is supported, which also enforces "no mixing per inquiry". */
export const SUPPORTED_CURRENCIES = [DEFAULT_CURRENCY] as const;

export const MAX_INQUIRY_ITEMS = 200;
export const MAX_TEXT_LENGTH = 500;

export interface ProductSearchResponse {
  products: Product[];
}

export interface ProductCatalogueResponse {
  products: Product[];
  count: number;
}

export interface ProductResponse {
  product: Product;
}

export interface InquiryItemRequest {
  productId: string;
  /** Required. Zero is allowed; absent, null and negative are not. */
  quotedPrice: number;
  notes: string;
}

export interface CreateInquiryRequest {
  customerName: string;
  companyName: string;
  notes: string;
  currency: string;
  items: InquiryItemRequest[];
  /** Cryptographically random UUID generated on the device before first POST. */
  clientSubmissionId: string;
}

export interface CreateInquiryResponse {
  inquiryId: string;
}

export interface SavedInquiryListItem {
  id: string;
  savedAt: string;
  customerName: string;
  companyName: string | null;
  productCount: number;
  currency: string;
  hasNotes: boolean;
}

export interface SavedInquiryListResponse {
  inquiries: SavedInquiryListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SavedInquiryLine {
  productCode: string;
  productName: string | null;
  quotedUnitPrice: number;
  notes: string | null;
}

export interface SavedInquiryDetail {
  id: string;
  savedAt: string;
  customerName: string;
  companyName: string | null;
  notes: string | null;
  currency: string;
  items: SavedInquiryLine[];
}

export interface SavedInquiryDetailResponse {
  inquiry: SavedInquiryDetail;
}

export interface SavedInquiryExportRow {
  inquiryId: string;
  savedAt: string;
  customerName: string;
  companyName: string;
  generalNotes: string;
  currency: string;
  productCode: string;
  productName: string;
  quotedUnitPrice: string;
  productNotes: string;
}

export interface ApiErrorResponse {
  error: string;
  details?: string[];
}

export type ValidationResult =
  | { ok: true; value: CreateInquiryRequest }
  | { ok: false; errors: string[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validates an untrusted request body. Runs on the server only; the client is
 * never trusted to have checked any of this.
 *
 * Quantity is not part of the client contract. If a stale client still sends
 * it, the value is ignored rather than stored.
 */
export function validateCreateInquiry(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerName = readText(body.customerName);
  if (customerName === "") {
    errors.push("A customer name is required.");
  } else if (customerName.length > MAX_TEXT_LENGTH) {
    errors.push(`Customer name must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  }

  const companyName = readText(body.companyName);
  const notes = readText(body.notes);

  for (const [label, text] of [
    ["Company name", companyName],
    ["Notes", notes],
  ] as const) {
    if (text.length > MAX_TEXT_LENGTH) {
      errors.push(`${label} must be ${MAX_TEXT_LENGTH} characters or fewer.`);
    }
  }

  const currency = readText(body.currency) || DEFAULT_CURRENCY;
  if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
    errors.push(`Currency ${currency} is not supported.`);
  }

  const clientSubmissionId = readText(body.clientSubmissionId);
  if (clientSubmissionId === "") {
    errors.push("A client submission id is required.");
  } else if (!UUID_PATTERN.test(clientSubmissionId)) {
    errors.push("Client submission id is not a valid UUID.");
  }

  const rawItems = body.items;
  const items: InquiryItemRequest[] = [];

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push("At least one product is required.");
  } else if (rawItems.length > MAX_INQUIRY_ITEMS) {
    errors.push(`An inquiry cannot hold more than ${MAX_INQUIRY_ITEMS} products.`);
  } else {
    rawItems.forEach((rawItem, index) => {
      const position = `Item ${index + 1}`;

      if (!isRecord(rawItem)) {
        errors.push(`${position} is not an object.`);
        return;
      }

      const productId = readText(rawItem.productId);
      if (!UUID_PATTERN.test(productId)) {
        errors.push(`${position} has an invalid product id.`);
      }

      // A quoted price is mandatory. Zero is accepted as a deliberate choice,
      // but null, undefined, a blank string and anything non-numeric are not.
      const raw = rawItem.quotedPrice;
      let quotedPrice = 0;
      if (raw === null || raw === undefined || raw === "") {
        errors.push(`${position} needs a quoted price.`);
      } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
        errors.push(`${position} has an invalid quoted price.`);
      } else if (raw < 0) {
        errors.push(`${position} cannot have a negative quoted price.`);
      } else {
        quotedPrice = raw;
      }

      const itemNotes = readText(rawItem.notes);
      if (itemNotes.length > MAX_TEXT_LENGTH) {
        errors.push(`${position} notes must be ${MAX_TEXT_LENGTH} characters or fewer.`);
      }

      if (errors.length === 0) {
        items.push({ productId, quotedPrice, notes: itemNotes });
      }
    });

    const uniqueIds = new Set(items.map((item) => item.productId));
    if (items.length > 0 && uniqueIds.size !== items.length) {
      errors.push("The same product appears more than once.");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { customerName, companyName, notes, currency, items, clientSubmissionId },
  };
}
