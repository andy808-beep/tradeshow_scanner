import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToInquiry from "@/components/add-to-inquiry";
import { DetailRow } from "@/components/pending";
import { formatMoney } from "@/lib/format";
import { getProductByCode } from "@/lib/supabase/products";
import { productTitle } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/products/[code]">,
): Promise<Metadata> {
  const { code } = await props.params;
  return { title: `${code} · Koei Porcelain` };
}

export default async function ProductPage(props: PageProps<"/products/[code]">) {
  const { code } = await props.params;

  let product;
  try {
    product = await getProductByCode(code);
  } catch (error) {
    console.error("Could not load product from Supabase:", error);
    return (
      <div className="space-y-4">
        <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
          ← Back to search
        </Link>
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p className="font-semibold">Database unavailable</p>
          <p className="mt-1">
            {code} could not be loaded right now. Check the connection and try again.
          </p>
        </div>
      </div>
    );
  }

  if (!product) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-block text-sm font-medium text-porcelain-600">
        ← Back to search
      </Link>

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
        <DetailRow label="Barcode" value={product.barcode} />
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
