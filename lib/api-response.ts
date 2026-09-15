import { NextResponse } from "next/server";
import type { ApiErrorResponse } from "./api-contract";
import {
  DatabaseError,
  InquiryValidationError,
  SupabaseConfigError,
} from "./supabase/errors";

export const DATABASE_UNAVAILABLE = "The product database is not available.";

export function errorResponse(
  message: string,
  status: number,
  details?: string[],
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    details && details.length > 0 ? { error: message, details } : { error: message },
    { status },
  );
}

/**
 * Maps an internal error onto a response. Underlying messages are logged on the
 * server and deliberately not echoed back, so connection strings and keys can
 * never leak through an API response.
 */
export function handleRouteError(error: unknown): NextResponse<ApiErrorResponse> {
  if (error instanceof InquiryValidationError) {
    return errorResponse(error.message, 400, error.details);
  }

  if (error instanceof SupabaseConfigError) {
    console.error("Supabase is not configured:", error.message);
    return errorResponse(DATABASE_UNAVAILABLE, 503);
  }

  if (error instanceof DatabaseError) {
    console.error("Supabase request failed:", error.message);
    return errorResponse(DATABASE_UNAVAILABLE, 503);
  }

  console.error("Unexpected API error:", error);
  return errorResponse("Something went wrong.", 500);
}
