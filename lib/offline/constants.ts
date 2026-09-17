export const CATALOGUE_DB_NAME = "koei-tradeshow";
export const CATALOGUE_DB_VERSION = 2;
export const PRODUCTS_STORE = "products";
export const CODE_KEY_INDEX = "by-code-key";
export const META_STORE = "meta";
export const CATALOGUE_META_KEY = "catalogue";
export const READINESS_META_KEY = "readiness";

/** Service-worker cache for the app shell only — never API responses. */
export const SHELL_CACHE_NAME = "koei-shell-v1";
export const SHELL_CACHE_PREFIX = "koei-shell-";

export const OFFLINE_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LOCAL_SEARCH_RESULTS = 30;

/**
 * Ceiling for any optional network refresh. Local results are already on
 * screen by then, so a stalled request is abandoned rather than awaited.
 */
export const NETWORK_REFRESH_TIMEOUT_MS = 4_000;

export const LOOKUP_MESSAGES = {
  unsynced: "Sync products while online.",
  expired:
    "Offline access has expired. Sign in while online and sync products again to see prices.",
  network: "The network is unavailable. Cached products are still shown when a catalogue exists.",
  syncFailed: "Synchronization failed. The previous catalogue on this device was kept.",
  notFoundLocal: "No match in synchronized catalogue.",
  localUnavailable:
    "The offline catalogue on this device could not be read. Sync products while online.",
  empty: "The synchronized catalogue is empty.",
} as const;

/**
 * Offline setup is only complete once the catalogue, the scanner and decoder
 * chunks and the camera itself have all been proven in this installed context.
 * A synced catalogue alone is never announced as offline ready.
 */
export const READINESS_MESSAGES = {
  scannerAssets:
    "Scanner files are still downloading. Stay online and tap Sync products again if this does not clear.",
  cameraTest: "Products synced — test camera to finish offline setup",
  ready: "Offline ready",
} as const;
