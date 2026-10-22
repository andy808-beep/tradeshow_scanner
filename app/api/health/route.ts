import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — same-origin reachability probe.
 *
 * Any HTTP response, including 401, proves the app server was reached.
 * The body is only `{ ok: true }`. No catalogue, customer or credential data.
 * `Cache-Control: no-store` and the service worker's `/api/*` bypass keep
 * this response out of HTTP and Cache Storage.
 */
export const GET = withAuthenticatedApi(async (_request: Request) => {
  void _request;
  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
});
