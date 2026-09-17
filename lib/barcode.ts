import type { Product } from "./types";

/**
 * Helpers shared by the scanner UI and its tests.
 *
 * Nothing here imports `@zxing/*` at runtime: the scanner loads those modules
 * lazily and passes their enums in, which keeps the library out of the search
 * page bundle and lets tests run without it.
 */

/**
 * ZXing `BarcodeFormat` member names this scanner accepts, most important
 * first.
 *
 * Code 39 leads because Koei's own labels use it: the legacy system renders the
 * barcode graphic straight from the company product code. The rest stay enabled
 * as fallbacks for supplier labels and QR codes.
 *
 * Note that ZXing decides precedence itself — `MultiFormatOneDReader` builds its
 * reader list in a fixed order and only checks whether a format is present here,
 * so this order documents intent rather than driving the decoder. Code 39 being
 * "primary" is enforced where it actually changes behaviour: `resolveScanMatch`
 * and `searchProducts` try `product_code` before `barcode`.
 *
 * ASSUME_CODE_39_CHECK_DIGIT is deliberately NOT set: the legacy generator emits
 * no check digit, and enabling it would strip the last real character.
 */
export const SUPPORTED_FORMAT_NAMES = [
  "CODE_39",
  "CODE_128",
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "QR_CODE",
] as const;

/** The format Koei's own product labels are printed in. */
export const PRIMARY_FORMAT_NAME: SupportedFormatName = "CODE_39";

export type SupportedFormatName = (typeof SUPPORTED_FORMAT_NAMES)[number];

/** Rear camera where available; `ideal` keeps laptops working as a fallback. */
export const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};

type EnumLike = Record<string, unknown>;

export function buildDecodeHints(
  decodeHintType: EnumLike,
  barcodeFormat: EnumLike,
): Map<number, unknown> {
  const formats = SUPPORTED_FORMAT_NAMES.map((name) => barcodeFormat[name]).filter(
    (value): value is number => typeof value === "number",
  );

  const hints = new Map<number, unknown>();
  hints.set(decodeHintType.POSSIBLE_FORMATS as number, formats);
  hints.set(decodeHintType.TRY_HARDER as number, true);
  return hints;
}

export type ScanMatch =
  | { kind: "single"; product: Product }
  | { kind: "multiple"; products: Product[] }
  | { kind: "none" };

/**
 * Decides what to do with search results for a scanned value.
 *
 * `product_code` is checked before `barcode`, because a Code 39 label printed
 * by Koei encodes the product code itself. `barcode` is only a fallback for
 * external supplier labels that carry a different value.
 *
 * Comparison is case-insensitive, but `rawValue` is never modified — no numeric
 * conversion, no case change, no hyphen stripping — so callers keep the exact
 * decoded string for searching and display.
 */
export function resolveScanMatch(rawValue: string, products: Product[]): ScanMatch {
  if (products.length === 0) return { kind: "none" };

  const needle = rawValue.trim().toLowerCase();

  const byCode = products.filter((product) => product.code.toLowerCase() === needle);
  if (byCode.length === 1) return { kind: "single", product: byCode[0] };

  if (byCode.length === 0) {
    const byBarcode = products.filter(
      (product) => product.barcode?.toLowerCase() === needle,
    );
    if (byBarcode.length === 1) return { kind: "single", product: byBarcode[0] };

    if (byBarcode.length === 0 && products.length === 1) {
      return { kind: "single", product: products[0] };
    }
  }

  return { kind: "multiple", products };
}

export type CameraErrorReason =
  | "denied"
  | "noCamera"
  | "inUse"
  | "insecure"
  | "unsupported"
  | "assetsMissing"
  | "unknown";

export interface CameraErrorInfo {
  reason: CameraErrorReason;
  message: string;
}

export const CAMERA_UNSUPPORTED: CameraErrorInfo = {
  reason: "unsupported",
  message: "This browser does not provide camera access.",
};

/** The decoder chunks were never cached, so scanning cannot start offline. */
export const SCANNER_ASSETS_MISSING: CameraErrorInfo = {
  reason: "assetsMissing",
  message:
    "Scanner files are not on this device yet. Reconnect, tap Sync products, then run Test camera.",
};

export function describeCameraError(error: unknown): CameraErrorInfo {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        reason: "denied",
        message:
          "Camera access was blocked. Allow the camera for this site in your browser settings, then try again.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { reason: "noCamera", message: "No camera was found on this device." };
    case "NotReadableError":
    case "TrackStartError":
      return {
        reason: "inUse",
        message: "The camera is being used by another app. Close it and try again.",
      };
    case "SecurityError":
      return {
        reason: "insecure",
        message: "The camera needs a secure (HTTPS) connection.",
      };
    default:
      return { reason: "unknown", message: "The camera could not be started." };
  }
}

/** True only in a browser that exposes `getUserMedia`; safe during SSR. */
export function hasCameraSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Stops every track on the video element's stream and detaches it. Returns how
 * many tracks were stopped so tests can assert the camera was released.
 */
export function stopMediaStream(video: HTMLVideoElement | null | undefined): number {
  if (!video) return 0;

  const stream = video.srcObject as MediaStream | null;
  let stopped = 0;

  if (stream && typeof stream.getTracks === "function") {
    for (const track of stream.getTracks()) {
      track.stop();
      stopped += 1;
    }
  }

  video.srcObject = null;
  return stopped;
}
