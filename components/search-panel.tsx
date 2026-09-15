"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { searchProductsRequest } from "@/lib/api-client";
import type { Product } from "@/lib/types";
import ProductCard from "./product-card";
import ScanButton from "./scan-button";

// Client-only and lazily loaded: the scanner and ZXing stay out of the initial
// search bundle, and nothing touches `navigator` during server rendering.
const BarcodeScanner = dynamic(() => import("./barcode-scanner"), { ssr: false });

const DEBOUNCE_MS = 250;

type SearchOutcome =
  | { status: "ready"; products: Product[] }
  | { status: "error"; message: string };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  /** Tagged with the query it belongs to, so a stale reply is never shown. */
  const [outcome, setOutcome] = useState<{
    query: string;
    result: SearchOutcome;
  } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const trimmed = query.trim();

  /** A scan that matched several products lands back on this page. */
  function showScanResults(rawValue: string, products: Product[]) {
    setScannerOpen(false);
    setQuery(rawValue);
    setOutcome({ query: rawValue.trim(), result: { status: "ready", products } });
  }

  useEffect(() => {
    if (trimmed === "") return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const products = await searchProductsRequest(trimmed, controller.signal);
        setOutcome({ query: trimmed, result: { status: "ready", products } });
      } catch (error) {
        // A newer keystroke aborted this request; its result is irrelevant.
        if (isAbortError(error) || controller.signal.aborted) return;
        setOutcome({
          query: trimmed,
          result: {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The product database is not available.",
          },
        });
      }
    }, DEBOUNCE_MS);

    // Cancels both the pending debounce and any request already in flight.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const view: SearchOutcome | { status: "idle" } | { status: "loading" } =
    trimmed === ""
      ? { status: "idle" }
      : outcome?.query === trimmed
        ? outcome.result
        : { status: "loading" };

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <div className="flex-1">
          <label htmlFor="product-search" className="sr-only">
            Search by product code or name
          </label>
          <input
            id="product-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Product code or name"
            autoComplete="off"
            enterKeyHint="search"
            className="w-full rounded-xl border border-porcelain-300 bg-white px-3.5 py-3 text-base text-porcelain-950 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none"
          />
        </div>
        <ScanButton onClick={() => setScannerOpen(true)} />
      </div>

      {scannerOpen && (
        <BarcodeScanner
          onClose={() => setScannerOpen(false)}
          onMultipleResults={showScanResults}
        />
      )}

      <div aria-live="polite" aria-busy={view.status === "loading"}>
        {view.status === "idle" && (
          <p className="px-1 text-sm text-porcelain-500">
            Search by product code (for example K10188-13), barcode, or Chinese or
            English name.
          </p>
        )}

        {view.status === "loading" && (
          <p className="px-1 text-sm text-porcelain-500">Searching…</p>
        )}

        {view.status === "error" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-semibold">Database unavailable</p>
            <p className="mt-1">{view.message}</p>
            <p className="mt-1 text-amber-800">
              Check the connection and try again in a moment.
            </p>
          </div>
        )}

        {view.status === "ready" && view.products.length === 0 && (
          <p className="rounded-xl border border-dashed border-porcelain-300 bg-porcelain-50 px-4 py-6 text-center text-sm text-porcelain-600">
            No product matches “{trimmed}”.
          </p>
        )}

        {view.status === "ready" && view.products.length > 0 && (
          <>
            <p className="mb-2 px-1 text-xs tracking-wide text-porcelain-500 uppercase">
              {view.products.length} {view.products.length === 1 ? "result" : "results"}
            </p>
            <ul className="space-y-2">
              {view.products.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
