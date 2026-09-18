import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/api-response";
import { buildSavedInquiryCsv, savedInquiryExportFilename } from "@/lib/saved-inquiries/csv";
import { parseSavedInquiryListQuery } from "@/lib/saved-inquiries/query";
import { listSavedInquiryExportRows } from "@/lib/supabase/saved-inquiries";

export const dynamic = "force-dynamic";

/** GET /api/inquiries/export — UTF-8 CSV of every matching saved inquiry line. */
export const GET = withAuthenticatedApi(async (request: Request) => {
  const parsed = parseSavedInquiryListQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return errorResponse("The inquiry export could not be created.", 400, parsed.errors);
  }

  const rows = await listSavedInquiryExportRows(parsed.value);
  const csv = buildSavedInquiryCsv(rows);
  const filename = savedInquiryExportFilename();

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
