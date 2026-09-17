"use client";

import { useState } from "react";
import { currencySymbol, formatMoney } from "@/lib/format";
import {
  isLinePriced,
  parsePriceInput,
  sanitizeDecimalInput,
} from "@/lib/inquiry";
import { productTitle, type InquiryLine } from "@/lib/types";
import { useInquiry } from "./inquiry-store";

export const NO_LISTED_PRICE_MESSAGE =
  "Listed price unavailable — enter a quoted price";
export const PRICE_REQUIRED_MESSAGE = "Enter a quoted price before saving";

export default function InquiryLineCard({ line }: { line: InquiryLine }) {
  const { setQuotedUnitPrice, setLineNotes, removeLine } = useInquiry();
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  const { product } = line;
  const storedPrice = line.quotedUnitPrice === null ? "" : String(line.quotedUnitPrice);

  const priced = isLinePriced(line);
  const priceError = priced
    ? null
    : product.unitPrice === null
      ? NO_LISTED_PRICE_MESSAGE
      : PRICE_REQUIRED_MESSAGE;

  function handlePriceChange(next: string) {
    const sanitized = sanitizeDecimalInput(next);
    setPriceDraft(sanitized);
    setQuotedUnitPrice(product.id, parsePriceInput(sanitized));
  }

  return (
    <article className="rounded-xl border border-porcelain-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
            {product.code}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-porcelain-950">
            {productTitle(product)}
          </p>
          {product.nameEn && product.nameZh && (
            <p className="truncate text-sm text-porcelain-700">{product.nameEn}</p>
          )}
          {product.dimensions && (
            <p className="mt-1 text-sm text-porcelain-600">{product.dimensions}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => removeLine(product.id)}
          className="shrink-0 text-sm font-medium text-porcelain-500 underline"
        >
          Remove product
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {product.unitPrice !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-porcelain-600">Listed unit price</span>
            <span className="text-sm font-medium text-porcelain-950">
              {formatMoney(product.unitPrice, product.currency)}
            </span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`price-${product.id}`} className="text-sm text-porcelain-600">
              Quoted unit price
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-porcelain-500">
                {currencySymbol(product.currency)}
              </span>
              <input
                id={`price-${product.id}`}
                type="text"
                inputMode="decimal"
                value={priceDraft ?? storedPrice}
                onChange={(event) => handlePriceChange(event.target.value)}
                onBlur={() => setPriceDraft(null)}
                placeholder="Required"
                aria-invalid={priceError !== null}
                aria-describedby={priceError ? `price-error-${product.id}` : undefined}
                className={`h-11 w-28 rounded-lg border bg-white px-3 text-right text-base font-semibold text-porcelain-950 placeholder:text-sm placeholder:font-normal focus:ring-2 focus:outline-none ${
                  priceError
                    ? "border-red-400 placeholder:text-red-400 focus:border-red-500 focus:ring-red-200"
                    : "border-porcelain-300 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-porcelain-200"
                }`}
              />
            </div>
          </div>

          {priceError && (
            <p
              id={`price-error-${product.id}`}
              role="alert"
              className="mt-1.5 text-right text-xs font-medium text-red-700"
            >
              {priceError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`notes-${product.id}`} className="mb-1 block text-sm text-porcelain-600">
            Product notes
          </label>
          <textarea
            id={`notes-${product.id}`}
            value={line.notes}
            onChange={(event) => setLineNotes(product.id, event.target.value)}
            placeholder="Optional"
            rows={2}
            className="w-full resize-y rounded-lg border border-porcelain-300 bg-white px-3 py-2 text-sm text-porcelain-950 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none"
          />
        </div>
      </div>
    </article>
  );
}
