"use client";

import { useEffect, useState } from "react";
import { formatSyncTime } from "@/lib/offline/authorization";
import { readInquirySyncMeta } from "@/lib/offline/db";
import {
  attentionOutboxCount,
  listOutbox,
  pendingOutboxCount,
  recoverInterruptedSyncs,
} from "@/lib/offline/inquiry-outbox";
import { cacheAppShellPages, syncInquiryOutbox } from "@/lib/offline/inquiry-sync";
import { useCatalogue } from "./catalogue-provider";
import { useInquiry } from "./inquiry-store";

export default function InquirySyncStatus() {
  const { online } = useCatalogue();
  const { refreshConfirmation } = useInquiry();
  const [pending, setPending] = useState(0);
  const [attention, setAttention] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [savedInquiryHref, setSavedInquiryHref] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [rows, meta] = await Promise.all([listOutbox(), readInquirySyncMeta()]);
    setPending(pendingOutboxCount(rows));
    setAttention(attentionOutboxCount(rows));
    setLastSyncedAt(meta?.lastInquirySyncedAt ?? null);
    const latest = rows
      .filter((row) => row.status === "synchronized" && row.serverInquiryId)
      .sort((left, right) => (right.syncedAt ?? 0) - (left.syncedAt ?? 0))[0];
    setSavedInquiryHref(latest?.serverInquiryId ? `/inquiries/${latest.serverInquiryId}` : null);
  }

  async function runSync() {
    setSyncing(true);
    try {
      const result = await syncInquiryOutbox(online);
      setSignInNeeded(result.requiresSignIn);
      if (result.requiresSignIn) {
        setNotice("Sign in while online to synchronize saved inquiries.");
      } else if (result.awaiting === 0 && result.needsAttention === 0 && result.synchronized > 0) {
        setNotice("All inquiries synchronized.");
      } else {
        setNotice(null);
      }
      await refresh();
      await refreshConfirmation();
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void recoverAndRefresh();

    async function recoverAndRefresh() {
      await recoverInterruptedSyncs();
      await refresh();
      void cacheAppShellPages();
      if (online) void runSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + online handled below
  }, []);

  useEffect(() => {
    function onOnline() {
      void runSync();
    }
    function onVisible() {
      if (document.visibilityState === "visible") void runSync();
    }
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const show = pending > 0 || attention > 0 || lastSyncedAt !== null || notice !== null;
  if (!show) return null;

  return (
    <section className="print-chrome border-b border-porcelain-200 bg-white px-4 py-2 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-porcelain-800">
          {pending > 0
            ? `${pending} ${pending === 1 ? "inquiry" : "inquiries"} awaiting sync`
            : attention > 0
              ? `${attention} ${attention === 1 ? "inquiry needs" : "inquiries need"} attention`
              : "All inquiries synchronized"}
        </p>
        <button
          type="button"
          onClick={() => {
            void runSync();
          }}
          disabled={syncing || !online}
          className="rounded-lg border border-porcelain-400 px-2.5 py-1 text-[11px] font-semibold text-porcelain-800 disabled:text-porcelain-400"
        >
          {syncing ? "Syncing…" : "Sync inquiries"}
        </button>
      </div>
      {lastSyncedAt !== null && (
        <p className="mt-1 text-[11px] text-porcelain-600">
          Last inquiry sync {formatSyncTime(lastSyncedAt)}
        </p>
      )}
      {signInNeeded && (
        <p className="mt-1 text-[11px] font-medium text-amber-900">
          Sign in while online to synchronize saved inquiries.
        </p>
      )}
      {notice && !signInNeeded && (
        <p className="mt-1 text-[11px] font-medium text-emerald-800">{notice}</p>
      )}
      {online && savedInquiryHref && (
        <a
          href={savedInquiryHref}
          className="mt-1 inline-block text-[11px] font-semibold text-porcelain-800"
        >
          View saved inquiry
        </a>
      )}
      <p className="mt-1 text-[10px] leading-snug text-porcelain-500">
        Cached inquiry drafts on an unlocked authorized device can be read until
        you log out.
      </p>
    </section>
  );
}
