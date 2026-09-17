const LOGIN_PATH = "/login";
const MAX_NEXT_LENGTH = 2048;

function firstString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return null;
}

/**
 * Returns a same-origin relative path, or null if the value is missing or
 * would be an open redirect. Only paths that start with a single slash and
 * not two slashes are allowed.
 */
export function safeNextPath(raw: unknown): string | null {
  const value = firstString(raw);
  if (value === null || value === "") return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (decoded.length > MAX_NEXT_LENGTH) return null;
  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//")) return null;
  if (decoded.includes("\\")) return null;
  if (decoded.includes("://")) return null;
  if (/\s/.test(decoded)) return null;

  const pathOnly = decoded.split("?")[0]?.split("#")[0] ?? decoded;
  if (pathOnly === LOGIN_PATH || pathOnly.startsWith(`${LOGIN_PATH}/`)) {
    return null;
  }

  return decoded;
}

export function loginUrlWithNext(next: string): string {
  const safe = safeNextPath(next);
  if (!safe || safe === "/") return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

export function isLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Static assets the proxy must not intercept. Keep the `matcher` in
 * `proxy.ts` aligned with this list.
 */
export function isProxyExemptPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/static")) return true;
  if (pathname.startsWith("/_next/image")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname === "/site.webmanifest"
  ) {
    return true;
  }
  if (
    pathname === "/sw.js" ||
    pathname === "/service-worker.js" ||
    pathname === "/serviceworker.js"
  ) {
    return true;
  }
  return /\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff|woff2|ico|txt)$/i.test(pathname);
}

export function shouldRedirectUnauthenticatedPage(pathname: string): boolean {
  if (isProxyExemptPath(pathname)) return false;
  if (isLoginPath(pathname)) return false;
  if (isApiPath(pathname)) return false;
  return true;
}
