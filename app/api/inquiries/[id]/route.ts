import { NextResponse } from "next/server";
import type { SavedInquiryDetailResponse } from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/api-response";
import { isSavedInquiryId } from "@/lib/saved-inquiries/query";
import { getSavedInquiry } from "@/lib/supabase/saved-inquiries";

export const dynamic = "force-dynamic";

/** GET /api/inquiries/[id] — read-only saved inquiry snapshot. */
export const GET = withAuthenticatedApi(async (
  _request: Request,
  context: RouteContext<"/api/inquiries/[id]">,
) => {
  const { id } = await context.params;
  if (!isSavedInquiryId(id)) {
    return errorResponse("Inquiry not found.", 404);
  }

  const inquiry = await getSavedInquiry(id);
  if (!inquiry) {
    return errorResponse("Inquiry not found.", 404);
  }

  return NextResponse.json<SavedInquiryDetailResponse>(
    { inquiry },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
