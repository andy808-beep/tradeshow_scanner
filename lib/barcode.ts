import { zh } from "@/lib/i18n/zh-cn";
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

/** Preferred capture size. `ideal` lets a weaker camera open at a lower size. */
export const CAMERA_IDEAL_WIDTH = 1920;
export const CAMERA_IDEAL_HEIGHT = 1080;

/**
 * Efficient pass. Still most of a 1080p frame, so narrow bars are not reduced
 * to a thumbnail. The detail pass uses the camera frame itself.
 */
export const NORMAL_DECODE_LONG_EDGE = 1600;
export const DETAIL_DECODE_LONG_EDGE = CAMERA_IDEAL_WIDTH;
/** Every third attempt decodes a full-detail frame. */
export const DETAIL_PASS_EVERY = 3;
/** Gap after a finished attempt. The next frame waits until this one returns. */
export const DECODE_ATTEMPT_GAP_MS = 40;
/** How long a scan can stay undecoded before the on-screen hint appears. */
export const SCAN_ASSIST_AFTER_MS = 6_000;

/**
 * Rear camera, preferring 1080p. Focus is applied after the stream opens,
 * and only when the track lists it, so a missing focus mode cannot reject
 * the whole camera.
 */
export const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: CAMERA_IDEAL_WIDTH },
    height: { ideal: CAMERA_IDEAL_HEIGHT },
  } as MediaTrackConstraints,
};

/** Same camera, without a size, when the detailed request is rejected. */
export const RELAXED_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" } },
};

/** Last resort: any camera the browser can open. */
export const BASIC_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: true,
};

export const SCAN_CAMERA_REQUESTS: MediaStreamConstraints[] = [
  REAR_CAMERA_CONSTRAINTS,
  RELAXED_CAMERA_CONSTRAINTS,
  BASIC_CAMERA_CONSTRAINTS,
];

export function isConstraintFailure(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  return name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";
}

/**
 * Opens the rear camera. A rejected resolution or focus constraint falls
 * through to a simpler request. Permission and other failures do not retry.
 */
export async function openScanCamera(
  request: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
): Promise<{ stream: MediaStream; constraints: MediaStreamConstraints }> {
  let lastError: unknown;
  for (let index = 0; index < SCAN_CAMERA_REQUESTS.length; index += 1) {
    const constraints = SCAN_CAMERA_REQUESTS[index];
    try {
      const stream = await request(constraints);
      return { stream, constraints };
    } catch (error) {
      lastError = error;
      const canRetry = index < SCAN_CAMERA_REQUESTS.length - 1 && isConstraintFailure(error);
      if (!canRetry) throw error;
    }
  }
  throw lastError;
}

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
  message: zh.scanner.unsupported,
};

/** The decoder chunks were never cached, so scanning cannot start offline. */
export const SCANNER_ASSETS_MISSING: CameraErrorInfo = {
  reason: "assetsMissing",
  message: zh.scanner.assetsMissing,
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
        message: zh.scanner.permissionDenied,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { reason: "noCamera", message: zh.scanner.noCamera };
    case "NotReadableError":
    case "TrackStartError":
      return {
        reason: "inUse",
        message: zh.scanner.cameraInUse,
      };
    case "SecurityError":
      return {
        reason: "insecure",
        message: zh.scanner.insecure,
      };
    default:
      return { reason: "unknown", message: zh.scanner.cameraStartFailed };
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
/** Maps a ZXing format value back to a supported name, when the enum is the one we passed in. */
export function barcodeFormatLabel(
  format: unknown,
  barcodeFormat: Record<string, unknown>,
): string | null {
  if (typeof format !== "number") return null;
  for (const name of SUPPORTED_FORMAT_NAMES) {
    if (barcodeFormat[name] === format) return name;
  }
  return null;
}

export function firstVideoTrack(
  video: HTMLVideoElement | null | undefined,
): MediaStreamTrack | undefined {
  const stream = video?.srcObject as MediaStream | null;
  if (!stream) return undefined;
  if (typeof stream.getVideoTracks === "function") {
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) return videoTracks[0];
  }
  if (typeof stream.getTracks !== "function") return undefined;
  const tracks = stream.getTracks();
  return tracks.find((track) => track.kind === "video") ?? tracks[0];
}

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface ScanCameraSupport {
  torch: boolean;
  zoom: ZoomRange | null;
  canRefreshFocus: boolean;
}

const NO_CAMERA_EXTRAS: ScanCameraSupport = {
  torch: false,
  zoom: null,
  canRefreshFocus: false,
};

interface TrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
  zoom?: { min?: number; max?: number; step?: number };
  width?: { max?: number };
  height?: { max?: number };
}

function readCapabilities(track: MediaStreamTrack): TrackCapabilities | null {
  if (typeof track.getCapabilities !== "function") return null;
  try {
    return track.getCapabilities() as TrackCapabilities;
  } catch {
    return null;
  }
}

export function readZoomRange(capabilities: { zoom?: unknown } | null | undefined): ZoomRange | null {
  const zoom = capabilities?.zoom;
  if (!zoom || typeof zoom !== "object") return null;
  const range = zoom as { min?: unknown; max?: unknown; step?: unknown };
  if (typeof range.min !== "number" || typeof range.max !== "number" || !(range.max > range.min)) {
    return null;
  }
  const step = typeof range.step === "number" && range.step > 0 ? range.step : 0.1;
  return { min: range.min, max: range.max, step };
}

export function clampZoom(value: number, range: ZoomRange): number {
  if (!Number.isFinite(value)) return range.min;
  const steps = Math.round((value - range.min) / range.step);
  const stepped = range.min + steps * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, stepped));
  return Math.round(clamped * 1000) / 1000;
}

/** A quarter of the way up the range: larger than the widest view, short of the maximum crop. */
export function defaultZoom(range: ZoomRange): number {
  return clampZoom(range.min + (range.max - range.min) * 0.25, range);
}

/**
 * Asks an already-open track for the preferred size. A rejection leaves the
 * stream that getUserMedia already delivered.
 */
export async function preferScanResolution(
  track: MediaStreamTrack | null | undefined,
): Promise<void> {
  if (!track || typeof track.applyConstraints !== "function") return;
  const capabilities = readCapabilities(track);
  const width = Math.min(
    CAMERA_IDEAL_WIDTH,
    typeof capabilities?.width?.max === "number" ? capabilities.width.max : CAMERA_IDEAL_WIDTH,
  );
  const height = Math.min(
    CAMERA_IDEAL_HEIGHT,
    typeof capabilities?.height?.max === "number" ? capabilities.height.max : CAMERA_IDEAL_HEIGHT,
  );
  try {
    await track.applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
    });
  } catch {
    // The preview is already running at whatever size the browser allowed.
  }
}

/**
 * Turns on continuous autofocus when the open track advertises it.
 * Returns torch, zoom and whether a focus refresh can be attempted.
 * Failures are ignored so a camera that rejects a constraint still scans.
 */
export async function tuneScanCamera(
  track: MediaStreamTrack | null | undefined,
): Promise<ScanCameraSupport> {
  if (!track) return NO_CAMERA_EXTRAS;
  const capabilities = readCapabilities(track);
  if (!capabilities) return NO_CAMERA_EXTRAS;

  const focusModes = capabilities.focusMode;
  const canRefreshFocus =
    Array.isArray(focusModes) &&
    (focusModes.includes("continuous") || focusModes.includes("single-shot"));

  if (
    Array.isArray(focusModes) &&
    focusModes.includes("continuous") &&
    typeof track.applyConstraints === "function"
  ) {
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
      });
    } catch {
      // The preview is already running. Focus is best-effort.
    }
  }

  return {
    torch: capabilities.torch === true,
    zoom: readZoomRange(capabilities),
    canRefreshFocus,
  };
}

/**
 * One autofocus sweep when the device offers it, then continuous focus again.
 * Returns false when the track cannot do this safely.
 */
export async function refreshCameraFocus(
  track: MediaStreamTrack | null | undefined,
): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== "function") return false;
  const capabilities = readCapabilities(track);
  const modes = capabilities?.focusMode;
  if (!Array.isArray(modes)) return false;

  const apply = async (focusMode: string) => {
    await track.applyConstraints({
      advanced: [{ focusMode } as unknown as MediaTrackConstraintSet],
    });
  };

  try {
    if (modes.includes("single-shot")) {
      await apply("single-shot");
      if (modes.includes("continuous")) await apply("continuous");
      return true;
    }
    if (modes.includes("continuous")) {
      await apply("continuous");
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function setCameraZoom(
  track: MediaStreamTrack | null | undefined,
  value: number,
  range: ZoomRange,
): Promise<number | null> {
  if (!track || typeof track.applyConstraints !== "function") return null;
  const zoom = clampZoom(value, range);
  try {
    await track.applyConstraints({
      advanced: [{ zoom } as unknown as MediaTrackConstraintSet],
    });
    return zoom;
  } catch {
    return null;
  }
}

export interface CameraSettingsReport {
  width: number | null;
  height: number | null;
  facingMode: string | null;
  focusMode: string | null;
  zoom: number | null;
  deviceLabel: string;
}

export function readCameraSettings(
  track: MediaStreamTrack | null | undefined,
): CameraSettingsReport {
  const empty: CameraSettingsReport = {
    width: null,
    height: null,
    facingMode: null,
    focusMode: null,
    zoom: null,
    deviceLabel: track?.label ?? "",
  };
  if (!track || typeof track.getSettings !== "function") return empty;
  try {
    const settings = track.getSettings() as MediaTrackSettings & {
      focusMode?: string;
      zoom?: number;
    };
    return {
      width: typeof settings.width === "number" ? settings.width : null,
      height: typeof settings.height === "number" ? settings.height : null,
      facingMode: typeof settings.facingMode === "string" ? settings.facingMode : null,
      focusMode: typeof settings.focusMode === "string" ? settings.focusMode : null,
      zoom: typeof settings.zoom === "number" ? settings.zoom : null,
      deviceLabel: track.label ?? "",
    };
  } catch {
    return empty;
  }
}

export interface FrameSize {
  width: number;
  height: number;
  downscaled: boolean;
}

/**
 * Size of the canvas a frame is decoded from.
 * The detail pass keeps a 1080p frame intact. Smaller camera frames are never
 * enlarged or reduced. Nothing here uses a CSS scale.
 */
export function frameSizeForPass(
  sourceWidth: number,
  sourceHeight: number,
  pass: "normal" | "detail",
): FrameSize {
  const width = Math.max(0, Math.floor(sourceWidth));
  const height = Math.max(0, Math.floor(sourceHeight));
  if (width < 2 || height < 2) return { width, height, downscaled: false };

  const longEdge = Math.max(width, height);
  const limit = pass === "detail" ? DETAIL_DECODE_LONG_EDGE : NORMAL_DECODE_LONG_EDGE;
  if (longEdge <= limit) return { width, height, downscaled: false };

  const scale = limit / longEdge;
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
    downscaled: true,
  };
}

const canvasesWithoutContext = new WeakSet<HTMLCanvasElement>();

export function drawVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  pass: "normal" | "detail",
): FrameSize {
  const size = frameSizeForPass(video.videoWidth, video.videoHeight, pass);
  if (size.width < 2 || size.height < 2) return size;
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  if (canvasesWithoutContext.has(canvas)) return size;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    context = canvas.getContext("2d");
  }
  if (!context) {
    canvasesWithoutContext.add(canvas);
    return size;
  }
  try {
    context.drawImage(video, 0, 0, size.width, size.height);
  } catch {
    // A canvas without a real video frame still reports the size we would decode.
  }
  return size;
}

export interface DecodedFrame {
  text: string;
  format: unknown;
}

/**
 * Serial decode loop. A frame is not started until the previous one has
 * returned, and the first recognized text ends the loop. The text is passed
 * through unchanged.
 */
export async function decodeVideoFrames(options: {
  stopped: () => boolean;
  nextFrame: (pass: "normal" | "detail") => DecodedFrame | null | Promise<DecodedFrame | null>;
  onDecoded: (frame: DecodedFrame) => void;
  sleep?: (ms: number) => Promise<void>;
  gapMs?: number;
  detailEvery?: number;
}): Promise<void> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const gapMs = options.gapMs ?? DECODE_ATTEMPT_GAP_MS;
  const detailEvery = options.detailEvery ?? DETAIL_PASS_EVERY;
  let attempt = 0;

  while (!options.stopped()) {
    const pass: "normal" | "detail" =
      attempt % detailEvery === detailEvery - 1 ? "detail" : "normal";
    attempt += 1;
    let decoded: DecodedFrame | null = null;
    try {
      decoded = await options.nextFrame(pass);
    } catch {
      decoded = null;
    }
    if (options.stopped()) return;
    if (decoded && decoded.text.trim() !== "") {
      options.onDecoded(decoded);
      return;
    }
    if (options.stopped()) return;
    await sleep(gapMs);
  }
}

export async function setCameraTorch(
  track: MediaStreamTrack | null | undefined,
  enabled: boolean,
): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== "function") return false;
  try {
    await track.applyConstraints({
      advanced: [{ torch: enabled } as unknown as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

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
