"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { formatExpiryDate, formatSyncTime } from "@/lib/offline/authorization";
import { zh } from "@/lib/i18n/zh-cn";
import { LOOKUP_MESSAGES, READINESS_MESSAGES } from "@/lib/offline/constants";
import { useCatalogue } from "./catalogue-provider";

const BarcodeScanner = dynamic(() => import("./barcode-scanner"), { ssr: false });

export default function CatalogueStatus() {
  const { access, online, syncing, syncError, sync, meta, stage, confirmCameraReady } =
    useCatalogue();
  const [testingCamera, setTestingCamera] = useState(false);

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
          {online ? zh.sync.online : zh.sync.offline}
        </p>
        <div className="flex items-center gap-2">
          {stage === "cameraTest" && (
            <button
              type="button"
              onClick={() => setTestingCamera(true)}
              className="rounded-lg border border-porcelain-400 px-2.5 py-1 text-[11px] font-semibold text-porcelain-800"
            >
              {zh.scanner.testCamera}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void sync();
            }}
            disabled={syncing || !online}
            className="rounded-lg bg-porcelain-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-porcelain-300"
          >
            {syncing ? zh.sync.syncingProducts : zh.sync.syncProducts}
          </button>
        </div>
      </div>

      {lastSynced ? (
        <p className="mt-1 text-[11px] leading-snug text-porcelain-700">
          {zh.sync.lastProductSync} {formatSyncTime(lastSynced)}
          {meta ? ` · ${meta.count} 款产品` : ""}
          。{zh.sync.offlinePricesExpire} {expiresAt ? formatExpiryDate(expiresAt) : ""}。
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-snug text-amber-900">
          {online ? zh.sync.missingOnline : LOOKUP_MESSAGES.unsynced}
        </p>
      )}

      {stage === "ready" && (
        <p className="mt-1 text-[11px] font-semibold text-emerald-800">
          {READINESS_MESSAGES.ready}
        </p>
      )}

      {stage === "scannerAssets" && (
        <p className="mt-1 text-[11px] leading-snug text-amber-900">
          {READINESS_MESSAGES.scannerAssets}
        </p>
      )}

      {stage === "cameraTest" && (
        <p className="mt-1 text-[11px] leading-snug font-medium text-amber-900">
          {READINESS_MESSAGES.cameraTest}
        </p>
      )}

      {access.kind === "expired" && (
        <p className="mt-1 text-[11px] font-medium text-red-800">
          {LOOKUP_MESSAGES.expired}
        </p>
      )}

      {syncError && (
        <p
          className={`mt-1 text-[11px] font-medium ${
            access.kind === "ready" ? "text-amber-800" : "text-red-800"
          }`}
        >
          {syncError}
        </p>
      )}

      <p className="mt-1 text-[10px] leading-snug text-porcelain-500">
        {zh.sync.catalogueDeviceNotice}
      </p>

      {/* Mounted only on the tap above, so the camera is never requested
          without a user action. */}
      {testingCamera && (
        <BarcodeScanner
          purpose="test"
          onClose={() => setTestingCamera(false)}
          onCameraReady={confirmCameraReady}
        />
      )}
    </section>
  );
}
