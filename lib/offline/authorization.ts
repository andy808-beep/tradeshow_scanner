import { OFFLINE_AUTH_TTL_MS } from "./constants";

export interface CatalogueMeta {
  lastSyncedAt: number;
  count: number;
}

export type CatalogueAccess =
  | { kind: "missing" }
  | { kind: "expired"; meta: CatalogueMeta; expiresAt: number }
  | { kind: "ready"; meta: CatalogueMeta; expiresAt: number };

export function offlineExpiresAt(lastSyncedAt: number): number {
  return lastSyncedAt + OFFLINE_AUTH_TTL_MS;
}

export function isOfflineCatalogueAuthorized(
  lastSyncedAt: number,
  now = Date.now(),
): boolean {
  return now - lastSyncedAt <= OFFLINE_AUTH_TTL_MS && lastSyncedAt > 0;
}

export function inspectCatalogueAccess(
  meta: CatalogueMeta | null,
  now = Date.now(),
): CatalogueAccess {
  if (!meta || !Number.isFinite(meta.lastSyncedAt) || meta.lastSyncedAt <= 0) {
    return { kind: "missing" };
  }

  const expiresAt = offlineExpiresAt(meta.lastSyncedAt);
  if (!isOfflineCatalogueAuthorized(meta.lastSyncedAt, now)) {
    return { kind: "expired", meta, expiresAt };
  }

  return { kind: "ready", meta, expiresAt };
}

export function formatSyncTime(timestamp: number, locale?: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatExpiryDate(timestamp: number, locale?: string): string {
  return new Date(timestamp).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
