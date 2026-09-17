import { ApiError, createInquiryRequest } from "@/lib/api-client";
import { INQUIRY_SUBMIT_TIMEOUT_MS, SHELL_CACHE_NAME } from "./constants";
import { offlineDebug } from "./diagnostics";
import { isOnline } from "./lookup";
import {
  listOutbox,
  markOutboxAwaiting,
  markOutboxNeedsAttention,
  markOutboxSynchronized,
  markOutboxSyncing,
  pendingOutboxCount,
  recoverInterruptedSyncs,
  type InquiryOutboxRecord,
} from "./inquiry-outbox";

let inFlight: Promise<InquirySyncResult> | null = null;

export interface InquirySyncResult {
  attempted: number;
  synchronized: number;
  awaiting: number;
  needsAttention: number;
  requiresSignIn: boolean;
}

function emptyResult(): InquirySyncResult {
  return {
    attempted: 0,
    synchronized: 0,
    awaiting: 0,
    needsAttention: 0,
    requiresSignIn: false,
  };
}

export async function syncInquiryOutbox(online = isOnline()): Promise<InquirySyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync(online).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function resetInquirySyncForTests(): void {
  inFlight = null;
}

async function runSync(online: boolean): Promise<InquirySyncResult> {
  await recoverInterruptedSyncs();
  const result = emptyResult();
  const rows = await listOutbox();
  result.needsAttention = rows.filter((row) => row.status === "needs_attention").length;

  if (!online) {
    result.awaiting = pendingOutboxCount(rows);
    return result;
  }

  const queue = rows.filter((row) => row.status === "awaiting_sync");
  for (const row of queue) {
    result.attempted += 1;
    const outcome = await submitOne(row);
    if (outcome === "synced") {
      result.synchronized += 1;
    } else if (outcome === "sign-in") {
      result.requiresSignIn = true;
      result.awaiting += 1;
      break;
    } else if (outcome === "attention") {
      result.needsAttention += 1;
    } else {
      result.awaiting += 1;
    }
  }

  const remaining = await listOutbox();
  result.awaiting = pendingOutboxCount(remaining);
  result.needsAttention = remaining.filter((row) => row.status === "needs_attention").length;
  offlineDebug("inquiry.sync", {
    attempted: result.attempted,
    synchronized: result.synchronized,
    awaiting: result.awaiting,
  });
  return result;
}

async function submitOne(
  row: InquiryOutboxRecord,
): Promise<"synced" | "retry" | "attention" | "sign-in"> {
  await markOutboxSyncing(row.clientSubmissionId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INQUIRY_SUBMIT_TIMEOUT_MS);

  try {
    const inquiryId = await createInquiryRequest(row.payload, controller.signal);
    await markOutboxSynchronized(row.clientSubmissionId, inquiryId);
    return "synced";
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await markOutboxAwaiting(
        row.clientSubmissionId,
        "Sign in while online to synchronize this inquiry.",
      );
      return "sign-in";
    }

    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      await markOutboxNeedsAttention(
        row.clientSubmissionId,
        error.details[0] ?? error.message,
      );
      return "attention";
    }

    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The network timed out. This inquiry is still on this device."
        : error instanceof Error
          ? error.message
          : "The inquiry could not be synchronized.";
    await markOutboxAwaiting(row.clientSubmissionId, message);
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

export async function cacheAppShellPages(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const cache = await caches.open(SHELL_CACHE_NAME);
    await Promise.all(
      ["/", "/inquiry", "/labels"].map(async (path) => {
        const response = await fetch(path, { credentials: "same-origin" });
        if (response.ok) await cache.put(path, response.clone());
      }),
    );
  } catch {
    // Shell caching is best-effort; IndexedDB still holds the draft.
  }
}
