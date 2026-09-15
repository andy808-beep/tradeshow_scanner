"use client";

import { currencySymbol, formatAmount } from "@/lib/format";
import { useInquiry } from "./inquiry-store";

export default function InquirySummary() {
  const { totals, currency } = useInquiry();

  return (
    <section className="rounded-xl border border-porcelain-300 bg-porcelain-50 p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-porcelain-600 uppercase">
        Inquiry total
      </h2>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-porcelain-600">Products</dt>
          <dd className="font-medium text-porcelain-950">{totals.lineCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-porcelain-600">Total quantity</dt>
          <dd className="font-medium text-porcelain-950">{totals.totalQuantity}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-porcelain-600">Currency</dt>
          <dd className="font-medium text-porcelain-950">{currency}</dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-porcelain-300 pt-2">
          <dt className="text-base font-semibold text-porcelain-950">Quoted total</dt>
          <dd className="text-xl font-semibold text-porcelain-900">
            {currencySymbol(currency)}
            {formatAmount(totals.quotedTotal)}
          </dd>
        </div>
      </dl>

      {totals.unpricedLineCount > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-porcelain-600">
          {totals.unpricedLineCount}{" "}
          {totals.unpricedLineCount === 1 ? "product has" : "products have"} no quoted
          price yet and {totals.unpricedLineCount === 1 ? "is" : "are"} excluded from this
          total.
        </p>
      )}
    </section>
  );
}
