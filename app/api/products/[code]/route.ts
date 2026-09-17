import { NextResponse } from "next/server";
import type { ProductResponse } from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/api-response";
import { getProductByCode } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/** GET /api/products/[code] — one active product, or 404. */
export const GET = withAuthenticatedApi(async (
  _request: Request,
  context: RouteContext<"/api/products/[code]">,
) => {
  const { code } = await context.params;
  const product = await getProductByCode(code);

  if (!product) {
    return errorResponse(`No active product with code ${code}.`, 404);
  }

  return NextResponse.json<ProductResponse>({ product });
});
