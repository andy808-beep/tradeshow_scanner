"use client";

import { useEffect, useState } from "react";
import { ApiError, getSavedInquiryRequest } from "@/lib/api-client";
import type { SavedInquiryDetail } from "@/lib/api-contract";
import { formatMoney } from "@/lib/format";
import { zh } from "@/lib/i18n/zh-cn";
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
        setError(
          caught instanceof ApiError ? caught.message : zh.history.loadFailed,
        );
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
        ← {zh.inquiry.backToHistory}
      </ShellAnchor>

      <OnlineOnlyNotice>{zh.history.onlineRequired}</OnlineOnlyNotice>

      {!online ? null : loading ? (
        <p className="text-sm text-porcelain-500">{zh.history.loading}</p>
      ) : error ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">{error}</p>
        </div>
      ) : inquiry ? (
        <article className="space-y-4">
          <header>
            <h1 className="text-xl font-semibold text-porcelain-950">{zh.inquiry.detailHeading}</h1>
          </header>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-porcelain-500">{zh.inquiry.reference}</dt>
              <dd className="font-mono text-xs break-all font-medium text-porcelain-950">{inquiry.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-porcelain-500">{zh.inquiry.savedAt}</dt>
              <dd className="font-medium text-porcelain-950">
                {formatSyncTime(Date.parse(inquiry.savedAt))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-porcelain-500">{zh.inquiry.customerName}</dt>
              <dd className="font-medium text-porcelain-950">{inquiry.customerName}</dd>
            </div>
            {inquiry.companyName && (
              <div>
                <dt className="text-xs text-porcelain-500">{zh.inquiry.companyName}</dt>
                <dd className="font-medium text-porcelain-950">{inquiry.companyName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-porcelain-500">{zh.product.currency}</dt>
              <dd className="font-medium text-porcelain-950">{inquiry.currency}</dd>
            </div>
            {inquiry.notes && (
              <div>
                <dt className="text-xs text-porcelain-500">{zh.inquiry.generalNotes}</dt>
                <dd className="whitespace-pre-wrap text-porcelain-900">{inquiry.notes}</dd>
              </div>
            )}
          </dl>

          <h2 className="text-sm font-semibold text-porcelain-800">{zh.inquiry.interestedProducts}</h2>
          <ul className="space-y-2">
            {inquiry.items.map((item, index) => (
              <li
                key={`${item.productCode}-${index}`}
                className="rounded-xl border border-porcelain-200 bg-white p-4"
              >
                <p className="text-xs text-porcelain-500">{zh.product.code}</p>
                <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
                  {item.productCode}
                </p>
                <p className="mt-2 text-xs text-porcelain-500">{zh.product.name}</p>
                <p className="font-semibold text-porcelain-950">
                  {item.productName ?? item.productCode}
                </p>
                <p className="mt-2 text-xs text-porcelain-500">{zh.product.quotedUnitPrice}</p>
                <p className="text-sm text-porcelain-800">
                  {formatMoney(item.quotedUnitPrice, inquiry.currency)}
                </p>
                {item.notes && (
                  <>
                    <p className="mt-2 text-xs text-porcelain-500">{zh.product.notes}</p>
                    <p className="text-sm whitespace-pre-wrap text-porcelain-700">{item.notes}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </div>
  );
}
