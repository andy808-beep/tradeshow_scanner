import { NextResponse } from "next/server";
import type { ProductSearchResponse } from "@/lib/api-contract";
import { handleRouteError } from "@/lib/api-response";
import { searchProducts } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/** GET /api/products?q= — searches active products, exact code matches first. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";

  try {
    const products = await searchProducts(query);
    return NextResponse.json<ProductSearchResponse>({ products });
  } catch (error) {
    return handleRouteError(error);
  }
}
