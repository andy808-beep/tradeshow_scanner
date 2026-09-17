import type { CatalogueAccess } from "./authorization";

/**
 * Proof that offline scanning has actually been exercised on this device.
 *
 * `scannerAssetsReadyAt` records that the lazily loaded scanner and decoder
 * chunks were downloaded, and `cameraVerifiedAt` that the real scanner opened
 * the camera here. Neither can be inferred from a catalogue sync.
 */
export interface OfflineReadiness {
  scannerAssetsReadyAt: number | null;
  cameraVerifiedAt: number | null;
}

export const NO_READINESS: OfflineReadiness = {
  scannerAssetsReadyAt: null,
  cameraVerifiedAt: null,
};

export type OfflineStage =
  | "unsynced"
  | "expired"
  | "scannerAssets"
  | "cameraTest"
  | "ready";

export function offlineStage(
  access: CatalogueAccess,
  readiness: OfflineReadiness,
): OfflineStage {
  if (access.kind === "missing") return "unsynced";
  if (access.kind === "expired") return "expired";
  if (readiness.scannerAssetsReadyAt === null) return "scannerAssets";
  if (readiness.cameraVerifiedAt === null) return "cameraTest";
  return "ready";
}

export function isOfflineReady(
  access: CatalogueAccess,
  readiness: OfflineReadiness,
): boolean {
  return offlineStage(access, readiness) === "ready";
}
