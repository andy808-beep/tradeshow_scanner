import { NextResponse } from "next/server";
import type { ProductSearchResponse } from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { searchProducts } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/** GET /api/products?q= — searches active products, exact code matches first. */
export const GET = withAuthenticatedApi(async (request: Request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const products = await searchProducts(query);
  return NextResponse.json<ProductSearchResponse>({ products });
});
