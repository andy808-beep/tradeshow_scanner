"use client";

import {
  formatExpiryDate,
  formatSyncTime,
} from "@/lib/offline/authorization";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import { useCatalogue } from "./catalogue-provider";

export default function CatalogueStatus() {
  const { access, online, syncing, syncError, sync, meta } = useCatalogue();

  const lastSynced = access.kind === "missing" ? null : access.meta.lastSyncedAt;
  const expiresAt = access.kind === "missing" ? null : access.expiresAt;

  return (
    <section className="print-chrome border-b border-porcelain-200 bg-porcelain-50 px-4 py-2.5 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <p
          className={`text-[11px] font-semibold tracking-wide uppercase ${
            online ? "text-emerald-800" : "text-amber-800"
          }`}
        >
          {online ? "Online" : "Offline"}
        </p>
        <button
          type="button"
          onClick={() => {
            void sync();
          }}
          disabled={syncing || !online}
          className="rounded-lg bg-porcelain-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-porcelain-300"
        >
          {syncing ? "Syncing…" : "Sync products"}
        </button>
      </div>

      {lastSynced ? (
        <p className="mt-1 text-[11px] leading-snug text-porcelain-700">
          Last synced {formatSyncTime(lastSynced)}
          {meta
            ? ` · ${meta.count} ${meta.count === 1 ? "product" : "products"}`
            : ""}
          . Offline prices expire {expiresAt ? formatExpiryDate(expiresAt) : ""}.
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-snug text-amber-900">
          {LOOKUP_MESSAGES.unsynced} Tap Sync products while online.
        </p>
      )}

      {access.kind === "expired" && (
        <p className="mt-1 text-[11px] font-medium text-red-800">
          {LOOKUP_MESSAGES.expired}
        </p>
      )}

      {syncError && (
        <p className="mt-1 text-[11px] font-medium text-red-800">{syncError}</p>
      )}

      <p className="mt-1 text-[10px] leading-snug text-porcelain-500">
        Anyone with this device can read cached prices until that expiry. Log out
        to erase the local catalogue.
      </p>
    </section>
  );
}
