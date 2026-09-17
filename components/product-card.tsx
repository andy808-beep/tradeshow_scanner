import Link from "next/link";
import { productTitle, type Product } from "@/lib/types";
import { PendingValue } from "./pending";

const cardClasses =
  "block w-full text-left rounded-xl border border-porcelain-200 bg-white p-4 shadow-sm transition-colors active:bg-porcelain-50";

function CardBody({ product }: { product: Product }) {
  return (
    <>
      <p className="font-mono text-xs font-semibold tracking-wider text-porcelain-600">
        {product.code}
      </p>
      <p className="mt-1.5 text-base leading-snug font-semibold text-porcelain-950">
        {productTitle(product)}
      </p>
      {product.nameEn && product.nameZh && (
        <p className="text-sm text-porcelain-700">{product.nameEn}</p>
      )}
      <p className="mt-2 text-xs text-porcelain-500">
        <PendingValue value={product.dimensions} />
      </p>
    </>
  );
}

/**
 * With `onSelect` the card opens the cached product in place. That path works
 * offline; a route change would need a server response the device cannot get.
 */
export default function ProductCard({
  product,
  onSelect,
}: {
  product: Product;
  onSelect?: (product: Product) => void;
}) {
  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(product)} className={cardClasses}>
        <CardBody product={product} />
      </button>
    );
  }

  return (
    <Link
      href={`/products/${encodeURIComponent(product.code)}`}
      prefetch={false}
      className={cardClasses}
    >
      <CardBody product={product} />
    </Link>
  );
}
