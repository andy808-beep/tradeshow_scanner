export const CATALOGUE_DB_NAME = "koei-tradeshow";
export const CATALOGUE_DB_VERSION = 1;
export const PRODUCTS_STORE = "products";
export const META_STORE = "meta";
export const CATALOGUE_META_KEY = "catalogue";

/** Service-worker cache for the app shell only — never API responses. */
export const SHELL_CACHE_NAME = "koei-shell-v1";
export const SHELL_CACHE_PREFIX = "koei-shell-";

export const OFFLINE_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LOCAL_SEARCH_RESULTS = 30;

export const LOOKUP_MESSAGES = {
  unsynced: "The product catalogue has not been synchronized on this device.",
  expired:
    "Offline access has expired. Sign in while online and sync products again to see prices.",
  network: "The network is unavailable. Cached products are still shown when a catalogue exists.",
  syncFailed: "Synchronization failed. The previous catalogue on this device was kept.",
  notFoundLocal: "No matching product in the offline catalogue.",
  empty: "The synchronized catalogue is empty.",
} as const;
