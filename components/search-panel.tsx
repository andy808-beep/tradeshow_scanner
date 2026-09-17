"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import { searchProductsLocalFirst } from "@/lib/offline/lookup";
import type { Product } from "@/lib/types";
import ProductCard from "./product-card";
import ScanButton from "./scan-button";

const BarcodeScanner = dynamic(() => import("./barcode-scanner"), { ssr: false });

const DEBOUNCE_MS = 250;

type SearchOutcome =
  | { status: "ready"; products: Product[] }
  | { status: "error"; title: string; message: string };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const ERROR_TITLES: Record<string, string> = {
  unsynced: "Catalogue not synchronized",
  expired: "Offline access expired",
  network: "Network unavailable",
  notFoundLocal: "Product not found locally",
};

export default function SearchPanel() {
  const { products: catalogue, access, online } = useCatalogue();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<{
    query: string;
    result: SearchOutcome;
  } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const trimmed = query.trim();

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
        const result = await searchProductsLocalFirst(
          catalogue,
          access,
          trimmed,
          controller.signal,
          online,
        );
        if (result.status === "ready") {
          setOutcome({
            query: trimmed,
            result: { status: "ready", products: result.products },
          });
          return;
        }
        setOutcome({
          query: trimmed,
          result: {
            status: "error",
            title: ERROR_TITLES[result.reason] ?? "Unavailable",
            message: result.message,
          },
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
        setOutcome({
          query: trimmed,
          result: {
            status: "error",
            title: "Unavailable",
            message:
              error instanceof Error
                ? error.message
                : "The product database is not available.",
          },
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [access, catalogue, online, trimmed]);

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
            English name. Sync the catalogue before looking up prices.
          </p>
        )}

        {view.status === "loading" && (
          <p className="px-1 text-sm text-porcelain-500">Searching…</p>
        )}

        {view.status === "error" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-semibold">{view.title}</p>
            <p className="mt-1">{view.message}</p>
          </div>
        )}

        {view.status === "ready" && view.products.length === 0 && (
          <p className="rounded-xl border border-dashed border-porcelain-300 bg-porcelain-50 px-4 py-6 text-center text-sm text-porcelain-600">
            No matching product in the offline catalogue for “{trimmed}”.
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
