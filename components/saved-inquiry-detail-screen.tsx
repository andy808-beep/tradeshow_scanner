"use client";

import { useEffect, useState } from "react";
import { getSavedInquiryRequest } from "@/lib/api-client";
import type { SavedInquiryDetail } from "@/lib/api-contract";
import { formatMoney } from "@/lib/format";
import { formatSyncTime } from "@/lib/offline/authorization";
import { isOnline } from "@/lib/offline/lookup";
import { ShellAnchor } from "./app-path";
import OnlineOnlyNotice from "./online-only-notice";

export default function SavedInquiryDetailScreen({ id }: { id: string }) {
  const [online, setOnline] = useState(isOnline);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inquiry, setInquiry] = useState<SavedInquiryDetail | null>(null);

  useEffect(() => {
    function update() {
      setOnline(isOnline());
    }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!online) return;

    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getSavedInquiryRequest(id, controller.signal);
        if (!cancelled) setInquiry(result);
      } catch (caught: unknown) {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setInquiry(null);
        setError(caught instanceof Error ? caught.message : "This inquiry could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, online]);

  return (
    <div className="space-y-4">
      <ShellAnchor href="/inquiries" className="text-sm font-medium text-porcelain-600">
        ← Saved inquiries
      </ShellAnchor>

      <OnlineOnlyNotice>
        Saved inquiry history requires internet access. The current draft and queued
        inquiries on this device still work offline.
      </OnlineOnlyNotice>

      {!online ? null : loading ? (
        <p className="text-sm text-porcelain-500">Loading inquiry…</p>
      ) : error ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">Inquiry unavailable</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : inquiry ? (
        <article className="space-y-4">
          <header>
            <p className="text-xs font-medium tracking-wide text-porcelain-500 uppercase">
              Saved inquiry
            </p>
            <h1 className="text-xl font-semibold text-porcelain-950">{inquiry.customerName}</h1>
            <p className="mt-1 font-mono text-xs break-all text-porcelain-500">{inquiry.id}</p>
          </header>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-porcelain-500">Saved</dt>
              <dd className="font-medium text-porcelain-950">
                {formatSyncTime(Date.parse(inquiry.savedAt))}
              </dd>
            </div>
            {inquiry.companyName && (
              <div>
                <dt className="text-xs text-porcelain-500">Company</dt>
                <dd className="font-medium text-porcelain-950">{inquiry.companyName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-porcelain-500">Currency</dt>
              <dd className="font-medium text-porcelain-950">{inquiry.currency}</dd>
            </div>
            {inquiry.notes && (
              <div>
                <dt className="text-xs text-porcelain-500">General notes</dt>
                <dd className="whitespace-pre-wrap text-porcelain-900">{inquiry.notes}</dd>
              </div>
            )}
          </dl>

          <ul className="space-y-2">
            {inquiry.items.map((item, index) => (
              <li
                key={`${item.productCode}-${index}`}
                className="rounded-xl border border-porcelain-200 bg-white p-4"
              >
                <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
                  {item.productCode}
                </p>
                <p className="mt-1 font-semibold text-porcelain-950">
                  {item.productName ?? item.productCode}
                </p>
                <p className="mt-2 text-sm text-porcelain-800">
                  {formatMoney(item.quotedUnitPrice, inquiry.currency)}
                </p>
                {item.notes && (
                  <p className="mt-2 text-sm whitespace-pre-wrap text-porcelain-700">{item.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </div>
  );
}
