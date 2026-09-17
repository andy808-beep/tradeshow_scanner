"use client";

import Link from "next/link";
import AddToInquiry from "@/components/add-to-inquiry";
import { DetailRow } from "@/components/pending";
import { formatMoney } from "@/lib/format";
import { productTitle, type Product } from "@/lib/types";

/**
 * Product detail rendered from an already-resolved `Product`.
 *
 * Everything here comes from the object it is given — the IndexedDB copy when
 * offline — so no request is made while displaying a product or adding it to
 * the inquiry. `onBack` keeps the scan and search flows on the current route
 * instead of a navigation that would need a server response.
 */
export default function ProductDetailView({
  product,
  onBack,
}: {
  product: Product;
  onBack?: () => void;
}) {
  return (
    <div className="space-y-5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-block text-sm font-medium text-porcelain-600"
        >
          ← Back to search
        </button>
      ) : (
        <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
          ← Back to search
        </Link>
      )}

      <div>
        <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
          {product.code}
        </p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold text-porcelain-950">
          {productTitle(product)}
        </h1>
        {product.nameEn && product.nameZh && (
          <p className="text-base text-porcelain-700">{product.nameEn}</p>
        )}
      </div>

      <dl className="rounded-xl border border-porcelain-200 bg-white px-4 py-1 shadow-sm">
        <DetailRow label="Dimensions" value={product.dimensions} />
        <DetailRow
          label="Unit price"
          value={
            product.unitPrice === null
              ? null
              : formatMoney(product.unitPrice, product.currency)
          }
        />
        <DetailRow label="Packaging" value={product.packaging} />
      </dl>

      <AddToInquiry product={product} />
    </div>
  );
}
