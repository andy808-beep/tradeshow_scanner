"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, exportSavedInquiriesRequest, listSavedInquiriesRequest } from "@/lib/api-client";
import type { SavedInquiryListItem } from "@/lib/api-contract";
import { formatSyncTime } from "@/lib/offline/authorization";
import { isOnline } from "@/lib/offline/lookup";
import { recordedProductsLabel } from "@/lib/inquiry";
import { SAVED_INQUIRY_PAGE_SIZE } from "@/lib/saved-inquiries/constants";
import { savedInquiryListSearchParams } from "@/lib/saved-inquiries/query";
import { ShellAnchor } from "./app-path";
import OnlineOnlyNotice from "./online-only-notice";

const fieldClasses =
  "h-10 w-full rounded-lg border border-porcelain-300 bg-white px-2.5 text-sm text-porcelain-950 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none";

export default function SavedInquiriesScreen() {
  const [online, setOnline] = useState(isOnline);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ q: "", from: null as string | null, to: null as string | null });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inquiries, setInquiries] = useState<SavedInquiryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const params = useMemo(
    () =>
      savedInquiryListSearchParams({
        q: applied.q,
        from: applied.from,
        to: applied.to,
        page,
        pageSize: SAVED_INQUIRY_PAGE_SIZE,
      }),
    [applied, page],
  );

  const pageCount = Math.max(1, Math.ceil(total / SAVED_INQUIRY_PAGE_SIZE));

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
        const result = await listSavedInquiriesRequest(params, controller.signal);
        if (cancelled) return;
        setInquiries(result.inquiries);
        setTotal(result.total);
      } catch (caught: unknown) {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Saved inquiries could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [online, params]);

  const applyFilters = useCallback(() => {
    setPage(1);
    setApplied({
      q: query.trim(),
      from: from === "" ? null : from,
      to: to === "" ? null : to,
    });
  }, [from, query, to]);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const filterParams = savedInquiryListSearchParams({
        q: applied.q,
        from: applied.from,
        to: applied.to,
      });
      const { blob, filename } = await exportSavedInquiriesRequest(filterParams);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught: unknown) {
      setExportError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "The export could not be created.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium tracking-wide text-porcelain-500 uppercase">History</p>
        <h1 className="text-xl font-semibold text-porcelain-950">Saved inquiries</h1>
        <p className="mt-1 text-sm text-porcelain-600">
          Read-only record of synchronized trade-show inquiries.
        </p>
      </div>

      <OnlineOnlyNotice>
        Saved inquiry history requires internet access. The current draft and queued
        inquiries on this device still work offline.
      </OnlineOnlyNotice>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label className="block text-xs font-medium text-porcelain-600" htmlFor="saved-search">
          Search customer or company
        </label>
        <input
          id="saved-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={fieldClasses}
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-porcelain-600" htmlFor="saved-from">
              From
            </label>
            <input
              id="saved-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={fieldClasses}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-porcelain-600" htmlFor="saved-to">
              To
            </label>
            <input
              id="saved-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={fieldClasses}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-xl bg-porcelain-700 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              void handleExport();
            }}
            disabled={!online || exporting || loading}
            className="rounded-xl border border-porcelain-300 px-4 py-2.5 text-sm font-semibold text-porcelain-800 disabled:text-porcelain-400"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </form>

      {exportError && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {exportError}
        </p>
      )}

      {!online ? null : loading ? (
        <p className="text-sm text-porcelain-500">Loading saved inquiries…</p>
      ) : error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">Could not load saved inquiries</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : inquiries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-porcelain-300 bg-porcelain-50 px-4 py-6 text-center text-sm text-porcelain-600">
          No saved inquiries match these filters.
        </p>
      ) : (
        <ul className="space-y-2">
          {inquiries.map((inquiry) => (
            <li key={inquiry.id}>
              <article className="rounded-xl border border-porcelain-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-porcelain-500">
                  {formatSyncTime(Date.parse(inquiry.savedAt))}
                </p>
                <p className="mt-1 font-semibold text-porcelain-950">{inquiry.customerName}</p>
                {inquiry.companyName && (
                  <p className="text-sm text-porcelain-700">{inquiry.companyName}</p>
                )}
                <p className="mt-2 text-sm text-porcelain-600">
                  {recordedProductsLabel(inquiry.productCount)} · {inquiry.currency}
                  {inquiry.hasNotes ? " · Notes" : ""}
                </p>
                <p className="mt-1 font-mono text-xs break-all text-porcelain-500">{inquiry.id}</p>
                <ShellAnchor
                  href={`/inquiries/${inquiry.id}`}
                  className="mt-3 block w-full rounded-xl bg-porcelain-700 px-4 py-2.5 text-center text-sm font-semibold text-white"
                >
                  View
                </ShellAnchor>
              </article>
            </li>
          ))}
        </ul>
      )}

      {online && !loading && !error && total > SAVED_INQUIRY_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-porcelain-300 px-3 py-1.5 font-semibold text-porcelain-800 disabled:text-porcelain-400"
          >
            Previous
          </button>
          <p className="text-porcelain-600">
            Page {page} of {pageCount}
          </p>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount}
            className="rounded-lg border border-porcelain-300 px-3 py-1.5 font-semibold text-porcelain-800 disabled:text-porcelain-400"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
