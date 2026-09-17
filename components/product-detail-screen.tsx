"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AddToInquiry from "@/components/add-to-inquiry";
import { useCatalogue } from "@/components/catalogue-provider";
import { DetailRow } from "@/components/pending";
import { formatMoney } from "@/lib/format";
import { getProductLocalFirst } from "@/lib/offline/lookup";
import { productTitle, type Product } from "@/lib/types";

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
  const loading = resolved === null;

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
        ← Back to search
      </Link>

      {loading && <p className="text-sm text-porcelain-500">Loading product…</p>}

      {resolved?.error && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">{resolved.error.title}</p>
          <p className="mt-1">{resolved.error.message}</p>
        </div>
      )}

      {resolved?.product && (
        <>
          <div>
            <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
              {resolved.product.code}
            </p>
            <h1 className="mt-1 text-2xl leading-tight font-semibold text-porcelain-950">
              {productTitle(resolved.product)}
            </h1>
            {resolved.product.nameEn && resolved.product.nameZh && (
              <p className="text-base text-porcelain-700">{resolved.product.nameEn}</p>
            )}
          </div>

          <dl className="rounded-xl border border-porcelain-200 bg-white px-4 py-1 shadow-sm">
            <DetailRow label="Dimensions" value={resolved.product.dimensions} />
            <DetailRow
              label="Unit price"
              value={
                resolved.product.unitPrice === null
                  ? null
                  : formatMoney(resolved.product.unitPrice, resolved.product.currency)
              }
            />
            <DetailRow label="Packaging" value={resolved.product.packaging} />
          </dl>

          <AddToInquiry product={resolved.product} />
        </>
      )}
    </div>
  );
}
