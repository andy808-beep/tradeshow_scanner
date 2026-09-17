import { NextResponse } from "next/server";
import type { ProductSearchResponse } from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { listActiveProducts } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/labels?q= — active products for label printing.
 *
 * Empty `q` returns the catalogue (capped). Unlike /api/products this is meant
 * for browsing, not booth search, so an empty query is valid.
 */
export const GET = withAuthenticatedApi(async (request: Request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const products = await listActiveProducts(query);
  return NextResponse.json<ProductSearchResponse>({ products });
});
