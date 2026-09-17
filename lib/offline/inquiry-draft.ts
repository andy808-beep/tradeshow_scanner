import type { CreateInquiryRequest } from "@/lib/api-contract";
import type { InquiryDraftRecord } from "./inquiry-records";
import { DRAFT_RECORD_KEY, DRAFT_STORE } from "./constants";
import { getDb } from "./db";

export type { InquiryConfirmationSnapshot, InquiryDraftRecord } from "./inquiry-records";

export function newClientSubmissionId(): string {
  return crypto.randomUUID();
}

export async function readInquiryDraft(): Promise<InquiryDraftRecord | null> {
  const db = await getDb();
  return (await db.get(DRAFT_STORE, DRAFT_RECORD_KEY)) ?? null;
}

export async function writeInquiryDraft(draft: InquiryDraftRecord): Promise<void> {
  const db = await getDb();
  await db.put(DRAFT_STORE, draft, DRAFT_RECORD_KEY);
}

export async function clearInquiryDraft(): Promise<void> {
  const db = await getDb();
  await db.delete(DRAFT_STORE, DRAFT_RECORD_KEY);
}

export function draftToCreateRequest(
  draft: Pick<InquiryDraftRecord, "customer" | "currency" | "lines">,
  clientSubmissionId: string,
): CreateInquiryRequest {
  return {
    customerName: draft.customer.name.trim(),
    companyName: draft.customer.company.trim(),
    notes: draft.customer.notes.trim(),
    currency: draft.currency,
    clientSubmissionId,
    items: draft.lines.map((line) => ({
      productId: line.product.id,
      quotedPrice: line.quotedUnitPrice as number,
      notes: line.notes,
    })),
  };
}
