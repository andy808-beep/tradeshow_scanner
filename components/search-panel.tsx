"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import ProductDetailView from "@/components/product-detail-view";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import { lookupLocalSearch, refreshSearchFromApi } from "@/lib/offline/lookup";
import type { Product } from "@/lib/types";
import ProductCard from "./product-card";
import ScanButton from "./scan-button";

const BarcodeScanner = dynamic(() => import("./barcode-scanner"), { ssr: false });

const DEBOUNCE_MS = 250;

const ERROR_TITLES: Record<string, string> = {
  unsynced: "Catalogue not synchronized",
  expired: "Offline access expired",
  network: "Network unavailable",
  notFoundLocal: "Product not found locally",
};

export default function SearchPanel() {
  const {
    products: catalogue,
    access,
    online,
    localError,
    confirmCameraReady,
  } = useCatalogue();
  const [query, setQuery] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [refreshed, setRefreshed] = useState<{ query: string; products: Product[] } | null>(
    null,
  );
  const [refreshingQuery, setRefreshingQuery] = useState<string | null>(null);

  const trimmed = query.trim();

  /**
   * The local catalogue is searched during render. There is no awaited promise
   * between typing and seeing results, so the view can never be left waiting.
   */
  const local = useMemo(
    () => (trimmed === "" ? null : lookupLocalSearch(catalogue, access, trimmed)),
    [access, catalogue, trimmed],
  );

  // Optional refresh once local results are already on screen. Bounded and
  // abortable: failure or a stall simply leaves the local results in place.
  useEffect(() => {
    if (trimmed === "" || !online || access.kind !== "ready") return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRefreshingQuery(trimmed);
      void (async () => {
        try {
          const products = await refreshSearchFromApi(trimmed, controller.signal);
          if (cancelled || products === null) return;
          setRefreshed({ query: trimmed, products });
        } catch {
          // Local results stay on screen. A rejected refresh is not an error.
        } finally {
          if (!cancelled) setRefreshingQuery(null);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [access, online, trimmed]);

  function showScanResults(rawValue: string, products: Product[]) {
    setScannerOpen(false);
    setQuery(rawValue);
    setRefreshed({ query: rawValue.trim(), products });
  }

  /** Renders the cached product here: no navigation, no product request. */
  function showProduct(product: Product) {
    setScannerOpen(false);
    setSelected(product);
  }

  if (selected) {
    return <ProductDetailView product={selected} onBack={() => setSelected(null)} />;
  }

  const products =
    refreshed?.query === trimmed
      ? refreshed.products
      : local?.status === "ready"
        ? local.products
        : [];

  // Every query ends in one of these four states. There is no "searching"
  // state: local lookup is synchronous, so a spinner cannot be left behind.
  const phase =
    trimmed === ""
      ? "idle"
      : local?.status === "error"
        ? "error"
        : products.length > 0
          ? "results"
          : "empty";

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
          onProduct={showProduct}
          onMultipleResults={showScanResults}
          onCameraReady={confirmCameraReady}
        />
      )}

      <div aria-live="polite">
        {localError && (
          <div className="mb-2 rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-900">
            <p className="font-semibold">Offline catalogue unavailable</p>
            <p className="mt-1">{localError}</p>
          </div>
        )}

        {phase === "idle" && (
          <p className="px-1 text-sm text-porcelain-500">
            Search by product code (for example K10188-13), barcode, or Chinese or
            English name. Sync the catalogue before looking up prices.
          </p>
        )}

        {phase === "error" && local?.status === "error" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p className="font-semibold">
              {ERROR_TITLES[local.reason] ?? "Unavailable"}
            </p>
            <p className="mt-1">{local.message}</p>
          </div>
        )}

        {phase === "empty" && (
          <p className="rounded-xl border border-dashed border-porcelain-300 bg-porcelain-50 px-4 py-6 text-center text-sm text-porcelain-600">
            {LOOKUP_MESSAGES.notFoundLocal}
          </p>
        )}

        {phase === "results" && (
          <>
            <p className="mb-2 px-1 text-xs tracking-wide text-porcelain-500 uppercase">
              {products.length} {products.length === 1 ? "result" : "results"}
              {refreshingQuery === trimmed ? " · refreshing" : ""}
            </p>
            <ul className="space-y-2">
              {products.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} onSelect={showProduct} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
