import type { CreateInquiryRequest } from "@/lib/api-contract";
import type { CustomerDetails, InquiryLine } from "@/lib/types";

export interface InquiryConfirmationSnapshot {
  source: "queued" | "synced";
  clientSubmissionId: string;
  inquiryId: string | null;
  customerName: string;
  companyName: string;
  productCount: number;
}

export interface InquiryDraftRecord {
  customer: CustomerDetails;
  currency: string;
  lines: InquiryLine[];
  confirmation: InquiryConfirmationSnapshot | null;
  createdAt: number;
  updatedAt: number;
}

export type InquiryOutboxStatus =
  | "awaiting_sync"
  | "syncing"
  | "synchronized"
  | "needs_attention";

export interface InquiryOutboxRecord {
  clientSubmissionId: string;
  payload: CreateInquiryRequest;
  customerName: string;
  companyName: string;
  productCount: number;
  currency: string;
  createdAt: number;
  updatedAt: number;
  status: InquiryOutboxStatus;
  lastError: string | null;
  serverInquiryId: string | null;
  syncedAt: number | null;
}

export interface InquirySyncMeta {
  lastInquirySyncedAt: number | null;
}
