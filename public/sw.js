const SHELL_CACHE = "koei-shell-v1";
const SHELL_PREFIX = "koei-shell-";

const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/fonts/NotoSansSC-Regular.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isApiRequest(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  );
}

function isAppShellPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "/inquiry" ||
    pathname === "/labels" ||
    pathname === "/login" ||
    pathname.startsWith("/products/")
  );
}

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Authenticated application data must never enter the shell cache.
  // Inquiry API responses in particular stay out of Cache Storage.
  if (isApiRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isAppShellPath(url.pathname) && isRscRequest(request, url)) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function matchByPathname(cache, pathname) {
  const keys = await cache.keys();
  for (const key of keys) {
    if (new URL(key.url).pathname === pathname) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
  }
  return undefined;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (response.ok && isAppShellPath(url.pathname)) {
      // Only store shell HTML/RSC, never product or inquiry API payloads.
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const exact = await cache.match(request);
    if (exact) return exact;
    const byPath = await matchByPathname(cache, url.pathname);
    if (byPath) return byPath;
    const home = await cache.match("/");
    if (home && url.pathname === "/inquiry") return home;
    if (home) return home;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
