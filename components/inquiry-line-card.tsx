"use client";

import { useState } from "react";
import { currencySymbol, formatAmount } from "@/lib/format";
import {
  isLinePriced,
  lineTotal,
  parsePriceInput,
  sanitizeDecimalInput,
} from "@/lib/inquiry";
import { productTitle, type InquiryLine } from "@/lib/types";
import { useInquiry } from "./inquiry-store";
import { PendingBadge } from "./pending";
import QuantityStepper from "./quantity-stepper";

export const NO_LISTED_PRICE_MESSAGE =
  "Listed price unavailable — enter a quoted price";
export const PRICE_REQUIRED_MESSAGE = "Enter a quoted price before saving";

export default function InquiryLineCard({ line }: { line: InquiryLine }) {
  const { setQuantity, setQuotedUnitPrice, removeLine } = useInquiry();
  const [priceDraft, setPriceDraft] = useState<string | null>(null);

  const { product } = line;
  const storedPrice = line.quotedUnitPrice === null ? "" : String(line.quotedUnitPrice);
  const total = lineTotal(line);

  const priced = isLinePriced(line);
  // A product with no listed price starts blank, so name that cause explicitly
  // rather than making it look like the employee deleted something.
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
        </div>
        <button
          type="button"
          onClick={() => removeLine(product.id)}
          className="shrink-0 text-sm font-medium text-porcelain-500 underline"
        >
          Remove
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-porcelain-600">Quantity</span>
          <QuantityStepper
            value={line.quantity}
            onChange={(quantity) => setQuantity(product.id, quantity)}
            label={`Quantity for ${product.code}`}
          />
        </div>

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

        <div className="flex items-baseline justify-between gap-3 border-t border-porcelain-100 pt-3">
          <span className="text-sm text-porcelain-600">Line total</span>
          <span className="text-base font-semibold text-porcelain-950">
            {total === null ? (
              <PendingBadge />
            ) : (
              `${currencySymbol(product.currency)}${formatAmount(total)}`
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
