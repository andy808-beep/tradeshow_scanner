import { NextResponse } from "next/server";
import {
  validateCreateInquiry,
  type CreateInquiryResponse,
  type SavedInquiryListResponse,
} from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/api-response";
import { parseSavedInquiryListQuery } from "@/lib/saved-inquiries/query";
import { createInquiry } from "@/lib/supabase/inquiries";
import { listSavedInquiries } from "@/lib/supabase/saved-inquiries";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/inquiries — paginated saved-inquiry list, newest first. */
export const GET = withAuthenticatedApi(async (request: Request) => {
  const parsed = parseSavedInquiryListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return errorResponse("The inquiry list could not be loaded.", 400, parsed.errors);
  }

  const { inquiries, total } = await listSavedInquiries(parsed.value);
  return NextResponse.json<SavedInquiryListResponse>(
    {
      inquiries,
      total,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    },
    { headers: NO_STORE },
  );
});

/** POST /api/inquiries — validates the submission and saves it through the RPC. */
export const POST = withAuthenticatedApi(async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const validation = validateCreateInquiry(body);
  if (!validation.ok) {
    return errorResponse("The inquiry could not be saved.", 400, validation.errors);
  }

  const inquiryId = await createInquiry(validation.value);
  return NextResponse.json<CreateInquiryResponse>(
    { inquiryId },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
