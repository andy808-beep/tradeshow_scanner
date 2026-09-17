import { type NextRequest } from "next/server";
import { updateAuthSession } from "@/lib/auth/proxy";

export async function proxy(request: NextRequest) {
  return updateAuthSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on application routes. Skip static assets, optimized images, fonts,
     * manifests and service-worker files. The login page is matched so the
     * session can refresh, but it is not auth-gated.
     */
    "/((?!_next/static|_next/image|favicon.ico|fonts/|manifest\\.webmanifest|manifest\\.json|sw\\.js|service-worker\\.js|serviceworker\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff|woff2|ico|txt)$).*)",
  ],
};
