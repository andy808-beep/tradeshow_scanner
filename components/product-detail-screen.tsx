"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import ProductDetailView from "@/components/product-detail-view";
import { getProductLocalFirst } from "@/lib/offline/lookup";
import type { Product } from "@/lib/types";

const ERROR_TITLES = {
  unsynced: "Catalogue not synchronized",
  expired: "Offline access expired",
  network: "Network unavailable",
  notFoundLocal: "Product not found locally",
} as const;

type DetailView = {
  code: string;
  product: Product | null;
  error: { title: string; message: string } | null;
};

/** Route entry point: resolves `code` from IndexedDB first, then renders it. */
export default function ProductDetailScreen({ code }: { code: string }) {
  const { products, access, online } = useCatalogue();
  const [view, setView] = useState<DetailView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProductLocalFirst(products, access, code, online).then((result) => {
      if (cancelled) return;
      if (result.status === "ready") {
        setView({ code, product: result.product, error: null });
        return;
      }
      setView({
        code,
        product: null,
        error: { title: ERROR_TITLES[result.reason], message: result.message },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [access, code, online, products]);

  const resolved = view?.code === code ? view : null;

  if (resolved === null) {
    return (
      <div className="space-y-5">
        <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
          ← Back to search
        </Link>
        <p className="text-sm text-porcelain-500">Loading product…</p>
      </div>
    );
  }

  if (resolved.product) {
    return <ProductDetailView product={resolved.product} />;
  }

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
        ← Back to search
      </Link>
      {resolved.error && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">{resolved.error.title}</p>
          <p className="mt-1">{resolved.error.message}</p>
        </div>
      )}
    </div>
  );
}
