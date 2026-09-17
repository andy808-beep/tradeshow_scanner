/**
 * Downloads the lazily split scanner and decoder chunks ahead of time.
 *
 * The scanner component and `@zxing/*` are code-split, so their chunks are
 * only requested the first time Scan is opened. Without this preload a device
 * that syncs and then goes offline has no scanner code cached and the camera
 * cannot start. Fetching them here puts them in the service-worker static
 * cache while the employee is still online.
 */

let preload: Promise<boolean> | null = null;

async function loadChunks(): Promise<boolean> {
  try {
    await Promise.all([
      import("@/components/barcode-scanner"),
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    return true;
  } catch {
    // Retryable: a later sync or reconnect can try again.
    preload = null;
    return false;
  }
}

export function preloadScannerAssets(): Promise<boolean> {
  preload ??= loadChunks();
  return preload;
}

export function resetScannerPreloadForTests(): void {
  preload = null;
}
