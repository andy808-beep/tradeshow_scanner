import { NextResponse } from "next/server";
import {
  validateCreateInquiry,
  type CreateInquiryResponse,
} from "@/lib/api-contract";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/api-response";
import { createInquiry } from "@/lib/supabase/inquiries";

export const dynamic = "force-dynamic";

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
  return NextResponse.json<CreateInquiryResponse>({ inquiryId }, { status: 201 });
});
