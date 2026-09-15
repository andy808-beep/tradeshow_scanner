import { NextResponse } from "next/server";
import type { ProductSearchResponse } from "@/lib/api-contract";
import { handleRouteError } from "@/lib/api-response";
import { listActiveProducts } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/labels?q= — active products for label printing.
 *
 * Empty `q` returns the catalogue (capped). Unlike /api/products this is meant
 * for browsing, not booth search, so an empty query is valid.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";

  try {
    const products = await listActiveProducts(query);
    return NextResponse.json<ProductSearchResponse>({ products });
  } catch (error) {
    return handleRouteError(error);
  }
}
