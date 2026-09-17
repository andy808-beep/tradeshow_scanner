import type { CreateInquiryRequest } from "@/lib/api-contract";
import type { InquiryOutboxRecord } from "./inquiry-records";
import { OUTBOX_STORE } from "./constants";
import { getDb, writeInquirySyncMeta } from "./db";

export type { InquiryOutboxRecord, InquiryOutboxStatus, InquirySyncMeta } from "./inquiry-records";

export async function listOutbox(): Promise<InquiryOutboxRecord[]> {
  const db = await getDb();
  const rows = await db.getAll(OUTBOX_STORE);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function readOutboxRecord(
  clientSubmissionId: string,
): Promise<InquiryOutboxRecord | null> {
  const db = await getDb();
  return (await db.get(OUTBOX_STORE, clientSubmissionId)) ?? null;
}

export async function writeOutboxRecord(record: InquiryOutboxRecord): Promise<void> {
  const db = await getDb();
  await db.put(OUTBOX_STORE, { ...record, updatedAt: Date.now() });
}

export async function enqueueOutboxSnapshot(
  payload: CreateInquiryRequest,
  details: { customerName: string; companyName: string; productCount: number; currency: string },
): Promise<InquiryOutboxRecord> {
  const now = Date.now();
  const record: InquiryOutboxRecord = {
    clientSubmissionId: payload.clientSubmissionId,
    payload: structuredClone(payload),
    customerName: details.customerName,
    companyName: details.companyName,
    productCount: details.productCount,
    currency: details.currency,
    createdAt: now,
    updatedAt: now,
    status: "awaiting_sync",
    lastError: null,
    serverInquiryId: null,
    syncedAt: null,
  };
  await writeOutboxRecord(record);
  return record;
}

/**
 * Entries left in "syncing" after a crash or reload must not stay there.
 * They return to awaiting_sync so a later pass can retry the same snapshot.
 */
export async function recoverInterruptedSyncs(): Promise<number> {
  const rows = await listOutbox();
  let recovered = 0;
  for (const row of rows) {
    if (row.status !== "syncing") continue;
    await writeOutboxRecord({
      ...row,
      status: "awaiting_sync",
      lastError: row.lastError,
    });
    recovered += 1;
  }
  return recovered;
}

export function pendingOutboxCount(rows: InquiryOutboxRecord[]): number {
  return rows.filter(
    (row) => row.status === "awaiting_sync" || row.status === "syncing",
  ).length;
}

export function attentionOutboxCount(rows: InquiryOutboxRecord[]): number {
  return rows.filter((row) => row.status === "needs_attention").length;
}

export async function markOutboxSyncing(clientSubmissionId: string): Promise<void> {
  const row = await readOutboxRecord(clientSubmissionId);
  if (!row) return;
  await writeOutboxRecord({ ...row, status: "syncing", lastError: null });
}

export async function markOutboxSynchronized(
  clientSubmissionId: string,
  serverInquiryId: string,
): Promise<void> {
  const row = await readOutboxRecord(clientSubmissionId);
  if (!row) return;
  const syncedAt = Date.now();
  await writeOutboxRecord({
    ...row,
    status: "synchronized",
    serverInquiryId,
    syncedAt,
    lastError: null,
  });
  await writeInquirySyncMeta({ lastInquirySyncedAt: syncedAt });
}

export async function markOutboxAwaiting(
  clientSubmissionId: string,
  lastError: string,
): Promise<void> {
  const row = await readOutboxRecord(clientSubmissionId);
  if (!row) return;
  await writeOutboxRecord({
    ...row,
    status: "awaiting_sync",
    lastError,
  });
}

export async function markOutboxNeedsAttention(
  clientSubmissionId: string,
  lastError: string,
): Promise<void> {
  const row = await readOutboxRecord(clientSubmissionId);
  if (!row) return;
  await writeOutboxRecord({
    ...row,
    status: "needs_attention",
    lastError,
  });
}
