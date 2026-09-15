"use client";

import { describeCode39Error, isCode39Compatible } from "@/lib/code39";
import type { LabelLayout } from "@/lib/label-layout";
import { productTitle, type Product } from "@/lib/types";
import Code39Barcode from "./code39-barcode";

function LabelFace({ product, layout }: { product: Product; layout: LabelLayout }) {
  const compatible = isCode39Compatible(product.code);
  const innerWidth = Math.max(layout.widthMm - 2 * layout.marginMm, 1);

  return (
    <article
      className="label-card box-border flex flex-col overflow-hidden bg-white text-black"
      data-product-code={product.code}
      data-unit-price=""
      style={{
        width: `${layout.widthMm}mm`,
        height: `${layout.heightMm}mm`,
        padding: `${layout.marginMm}mm`,
      }}
    >
      {compatible ? (
        <div className="flex justify-center" style={{ maxWidth: `${innerWidth}mm` }}>
          <Code39Barcode
            value={product.code}
            moduleMm={layout.moduleMm}
            heightMm={layout.barcodeHeightMm}
            className="max-w-full"
          />
        </div>
      ) : (
        <p className="text-[10px] leading-tight text-red-700 print:hidden">
          {describeCode39Error(product.code)}
        </p>
      )}

      <p className="mt-1 font-mono text-[10px] leading-tight font-semibold tracking-wide">
        {product.code}
      </p>
      {product.nameZh && (
        <p className="text-[10px] leading-tight">{product.nameZh}</p>
      )}
      {product.nameEn && (
        <p className="text-[9px] leading-tight">{product.nameEn}</p>
      )}
      {product.dimensions && (
        <p className="mt-auto text-[9px] leading-tight">{product.dimensions}</p>
      )}
      <span className="sr-only">{productTitle(product)}</span>
    </article>
  );
}

export default function LabelSheet({
  products,
  layout,
}: {
  products: Product[];
  layout: LabelLayout;
}) {
  if (products.length === 0) {
    return (
      <p className="print:hidden px-1 text-sm text-porcelain-500">
        Select products to preview labels.
      </p>
    );
  }

  return (
    <div className="label-sheet flex flex-wrap content-start gap-[2mm] bg-white">
      {products.map((product, index) => (
        <LabelFace
          key={`${product.id}-${index}`}
          product={product}
          layout={layout}
        />
      ))}
    </div>
  );
}
