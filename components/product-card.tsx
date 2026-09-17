import Link from "next/link";
import { productTitle, type Product } from "@/lib/types";
import { PendingValue } from "./pending";

export default function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/products/${encodeURIComponent(product.code)}`}
      prefetch={false}
      className="block rounded-xl border border-porcelain-200 bg-white p-4 shadow-sm transition-colors active:bg-porcelain-50"
    >
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
    </Link>
  );
}
