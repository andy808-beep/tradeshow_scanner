import { NextResponse } from "next/server";
import type { ProductCatalogueResponse } from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { listAllActiveProducts } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/catalogue — complete active catalogue for offline sync.
 *
 * Authenticated employees only. The browser stores the result in IndexedDB;
 * this response is never placed in the service-worker cache.
 */
export const GET = withAuthenticatedApi(async (request: Request) => {
  void request;
  const products = await listAllActiveProducts();
  return NextResponse.json<ProductCatalogueResponse>(
    {
      products,
      count: products.length,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
});
