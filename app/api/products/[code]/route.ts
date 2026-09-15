import { NextResponse } from "next/server";
import type { ProductResponse } from "@/lib/api-contract";
import { errorResponse, handleRouteError } from "@/lib/api-response";
import { getProductByCode } from "@/lib/supabase/products";

export const dynamic = "force-dynamic";

/** GET /api/products/[code] — one active product, or 404. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/products/[code]">,
) {
  const { code } = await context.params;

  try {
    const product = await getProductByCode(code);

    if (!product) {
      return errorResponse(`No active product with code ${code}.`, 404);
    }

    return NextResponse.json<ProductResponse>({ product });
  } catch (error) {
    return handleRouteError(error);
  }
}
