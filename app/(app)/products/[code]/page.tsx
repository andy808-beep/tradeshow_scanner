import type { Metadata } from "next";
import ProductDetailScreen from "@/components/product-detail-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/products/[code]">,
): Promise<Metadata> {
  const { code } = await props.params;
  return { title: `${decodeURIComponent(code)} · Koei Porcelain` };
}

export default async function ProductPage(props: PageProps<"/products/[code]">) {
  const { code } = await props.params;
  return <ProductDetailScreen code={decodeURIComponent(code)} />;
}
