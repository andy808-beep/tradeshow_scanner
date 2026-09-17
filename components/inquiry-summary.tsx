"use client";

import { selectedProductsLabel } from "@/lib/inquiry";
import { useInquiry } from "./inquiry-store";

export default function InquirySummary() {
  const { summary, currency } = useInquiry();

  return (
    <section className="rounded-xl border border-porcelain-300 bg-porcelain-50 p-4">
      <p className="text-base font-semibold text-porcelain-950">
        {selectedProductsLabel(summary.productCount)}
      </p>
      <p className="mt-1 text-sm text-porcelain-600">Currency {currency}</p>

      {summary.productCount > 0 && summary.allPriced && (
        <p className="mt-3 text-xs leading-relaxed text-porcelain-600">
          All products have a quoted unit price.
        </p>
      )}

      {summary.unpricedCount > 0 && (
        <p className="mt-3 text-xs leading-relaxed font-medium text-red-700">
          {summary.unpricedCount === 1
            ? "1 product still needs a quoted unit price."
            : `${summary.unpricedCount} products still need a quoted unit price.`}
        </p>
      )}
    </section>
  );
}
