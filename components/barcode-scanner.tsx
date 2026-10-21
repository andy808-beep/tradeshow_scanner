"use client";

import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import {
  barcodeFormatLabel,
  buildDecodeHints,
  CAMERA_UNSUPPORTED,
  describeCameraError,
  firstVideoTrack,
  hasCameraSupport,
  REAR_CAMERA_CONSTRAINTS,
  SCANNER_ASSETS_MISSING,
  setCameraTorch,
  stopMediaStream,
  tuneScanCamera,
  type CameraErrorInfo,
} from "@/lib/barcode";
import { zh } from "@/lib/i18n/zh-cn";
import { SCAN_LOOKUP_TIMEOUT_MS } from "@/lib/offline/constants";
import {
  recordScanDiagnostic,
  type ScanDiagnosticResult,
  type ScanLookupSource,
} from "@/lib/offline/diagnostics";
import { scanProductsLocalFirst, type LocalFirstScan } from "@/lib/offline/lookup";
import type { Product } from "@/lib/types";

/**
 * Full-screen barcode scanner.
 *
 * Frames are decoded in memory by ZXing and never stored or uploaded; only the
 * decoded text leaves this component, and it is looked up in the local
 * catalogue first.
 */

type Status =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "recognized"; raw: string }
  | { kind: "lookingUp"; raw: string }
  | { kind: "notFound"; raw: string }
  | { kind: "lookupFailed"; raw: string; message: string }
  | { kind: "cameraError"; info: CameraErrorInfo };

function statusLabel(status: Status): string {
  switch (status.kind) {
    case "starting":
      return zh.scanner.loadingCamera;
    case "scanning":
      return zh.scanner.scanning;
    case "recognized":
      return zh.scanner.recognized(status.raw);
    case "lookingUp":
      return zh.scanner.lookingUp;
    case "notFound":
      return zh.scanner.productNotFoundCode(status.raw);
    case "lookupFailed":
      return status.message;
    case "cameraError":
      return zh.scanner.cameraUnavailable;
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface BarcodeScannerProps {
  onClose: () => void;
  /**
   * A single match, already resolved from the local catalogue. The caller
   * renders it in place: a route change would need a server response that an
   * offline device cannot get.
   */
  onProduct?: (product: Product) => void;
  /** Called when a scan matches several products, so the page can show them. */
  onMultipleResults?: (rawValue: string, products: Product[]) => void;
  /** Fires once the real camera is streaming, which completes offline setup. */
  onCameraReady?: () => void;
  /** "test" only proves the camera works; decoded values are ignored. */
  purpose?: "scan" | "test";
}

export default function BarcodeScanner({
  onClose,
  onProduct,
  onMultipleResults,
  onCameraReady,
  purpose = "scan",
}: BarcodeScannerProps) {
  const { products: catalogue, access, online } = useCatalogue();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  /** When the camera became ready to decode. Decode time is measured from here. */
  const scanStartedRef = useRef(0);
  /** Guards against the decode loop reporting the same code repeatedly. */
  const handledRef = useRef(false);
  /** Bumped on retry and unmount so a late lookup cannot overwrite a new scan. */
  const generationRef = useRef(0);

  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [manualValue, setManualValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /** Bumped to restart the camera after a retry. */
  const [session, setSession] = useState(0);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    stopMediaStream(videoRef.current);
  }, []);

  const lookUp = useCallback(
    async (rawValue: string, format: string | null = null) => {
      if (rawValue.trim() === "" || handledRef.current) return;
      handledRef.current = true;
      const generation = generationRef.current;
      const decodeMs = Math.max(0, Math.round(performance.now() - scanStartedRef.current));
      stopCamera();
      setStatus({ kind: "recognized", raw: rawValue });
      // Let the recognized code paint before lookup starts, so a slow camera
      // and a slow catalogue read can be told apart on the floor.
      await nextPaint();
      if (generation !== generationRef.current) return;

      setStatus({ kind: "lookingUp", raw: rawValue });
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const lookupStarted = performance.now();

      const finish = (result: LocalFirstScan, lookupMs: number) => {
        let lookupSource: ScanLookupSource = "none";
        let diagnosticResult: ScanDiagnosticResult = "failed";
        if (result.status === "match") {
          lookupSource = result.source === "local" ? "local" : "online";
          diagnosticResult =
            result.match.kind === "single"
              ? "product"
              : result.match.kind === "multiple"
                ? "multiple"
                : "not-found";
        } else if (result.reason === "notFoundLocal") {
          lookupSource = "local";
          diagnosticResult = "not-found";
        } else if (
          result.reason === "network" &&
          lookupMs >= SCAN_LOOKUP_TIMEOUT_MS - 50
        ) {
          lookupSource = "online";
          diagnosticResult = "timeout";
        } else if (result.reason === "network") {
          lookupSource = "online";
          diagnosticResult = "failed";
        }
        recordScanDiagnostic({
          decodeMs,
          decodedValue: rawValue,
          format,
          lookupSource,
          lookupMs,
          result: diagnosticResult,
        });
      };

      try {
        const result = await scanProductsLocalFirst(
          catalogue,
          access,
          rawValue,
          controller.signal,
          online,
        );
        const lookupMs = Math.max(0, Math.round(performance.now() - lookupStarted));
        finish(result, lookupMs);
        if (generation !== generationRef.current || controller.signal.aborted) return;

        if (result.status === "error") {
          if (result.reason === "notFoundLocal") {
            setStatus({ kind: "notFound", raw: rawValue });
          } else {
            setStatus({
              kind: "lookupFailed",
              raw: rawValue,
              message: result.message,
            });
          }
          return;
        }

        const { match } = result;

        if (match.kind === "single") {
          onProduct?.(match.product);
          return;
        }

        if (match.kind === "multiple") {
          onMultipleResults?.(rawValue, match.products);
          return;
        }

        setStatus({ kind: "notFound", raw: rawValue });
      } catch (error) {
        const lookupMs = Math.max(0, Math.round(performance.now() - lookupStarted));
        recordScanDiagnostic({
          decodeMs,
          decodedValue: rawValue,
          format,
          lookupSource: "none",
          lookupMs,
          result: "failed",
        });
        if (generation !== generationRef.current || controller.signal.aborted) return;
        setStatus({
          kind: "lookupFailed",
          raw: rawValue,
          message:
            error instanceof Error
              ? error.message
              : zh.errors.productDataUnavailable,
        });
      }
    },
    [access, catalogue, onMultipleResults, onProduct, online, stopCamera],
  );

  // Held in refs so the camera effect never restarts when these change.
  const lookUpRef = useRef(lookUp);
  useEffect(() => {
    lookUpRef.current = lookUp;
  }, [lookUp]);

  const cameraReadyRef = useRef(onCameraReady);
  useEffect(() => {
    cameraReadyRef.current = onCameraReady;
  }, [onCameraReady]);

  const purposeRef = useRef(purpose);
  useEffect(() => {
    purposeRef.current = purpose;
  }, [purpose]);

  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | null = null;
    // Captured now: React detaches refs before passive effect cleanup runs, so
    // reading videoRef during cleanup would find null and leak the camera.
    const videoElement = videoRef.current;

    async function start() {
      // Loaded here so the library stays out of the search page bundle. The
      // chunks are preloaded during product sync, because offline they can no
      // longer be fetched.
      let modules;
      try {
        modules = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
      } catch {
        if (!cancelled) {
          setStatus({ kind: "cameraError", info: SCANNER_ASSETS_MISSING });
        }
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType: Hints }] =
          modules;

        if (cancelled) return;

        if (!hasCameraSupport()) {
          setStatus({ kind: "cameraError", info: CAMERA_UNSUPPORTED });
          return;
        }

        const video = videoElement;
        if (!video) return;

        const hints = buildDecodeHints(
          Hints as unknown as Record<string, unknown>,
          BarcodeFormat as unknown as Record<string, unknown>,
        ) as unknown as Map<DecodeHintType, unknown>;

        const reader = new BrowserMultiFormatReader(hints);
        scanStartedRef.current = performance.now();

        // Requests camera permission — only ever reached after the user
        // pressed Scan or Test camera, because this component mounts on that
        // press. The decoder reads the full frame; the on-screen box is only
        // a guide, so wide labels are not cropped out of the image.
        controls = await reader.decodeFromConstraints(
          REAR_CAMERA_CONSTRAINTS,
          video,
          (result) => {
            if (!result || handledRef.current) return;
            if (purposeRef.current === "test") return;
            const text = result.getText();
            if (text.trim() === "") return;
            const decoded = result as {
              getBarcodeFormat?: () => unknown;
            };
            const format =
              typeof decoded.getBarcodeFormat === "function"
                ? barcodeFormatLabel(
                    decoded.getBarcodeFormat(),
                    BarcodeFormat as unknown as Record<string, unknown>,
                  )
                : null;
            void lookUpRef.current(text, format);
          },
        );

        controlsRef.current = controls;

        if (cancelled) {
          controls.stop();
          controlsRef.current = null;
          stopMediaStream(video);
          return;
        }

        const track = firstVideoTrack(video);
        trackRef.current = track ?? null;
        const support = await tuneScanCamera(track);
        if (cancelled) return;
        setTorchAvailable(support.torch);
        setTorchOn(false);
        setStatus({ kind: "scanning" });
        // The camera really opened in this installed context, which is the
        // only proof that offline scanning will work later.
        cameraReadyRef.current?.();
      } catch (error) {
        if (cancelled) return;
        setStatus({ kind: "cameraError", info: describeCameraError(error) });
      }
    }

    void start();

    return () => {
      cancelled = true;
      controls?.stop();
      controlsRef.current = null;
      stopMediaStream(videoElement);
    };
  }, [session]);

  // Releases the camera and any in-flight lookup when the scanner unmounts.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  function handleClose() {
    stopCamera();
    abortRef.current?.abort();
    onClose();
  }

  function handleRetry() {
    generationRef.current += 1;
    abortRef.current?.abort();
    handledRef.current = false;
    setCopied(false);
    setTorchOn(false);
    setTorchAvailable(false);
    trackRef.current = null;
    setStatus({ kind: "starting" });
    setSession((value) => value + 1);
  }

  async function handleTorch() {
    const next = !torchOn;
    const ok = await setCameraTorch(trackRef.current, next);
    if (ok) setTorchOn(next);
  }

  function focusManualEntry() {
    document.getElementById("manual-code")?.focus();
  }

  function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = manualValue.trim();
    if (value === "") return;
    void lookUp(value);
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const testing = purpose === "test";
  const showViewfinder = status.kind === "starting" || status.kind === "scanning";
  const rawValue =
    status.kind === "notFound" ||
    status.kind === "lookupFailed" ||
    status.kind === "lookingUp"
      ? status.raw
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={testing ? zh.scanner.cameraTestLabel : zh.scanner.heading}
      className="fixed inset-0 z-50 flex flex-col bg-porcelain-950 text-white"
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <p
          aria-live="polite"
          className="rounded-full bg-black/40 px-3 py-1.5 text-sm font-medium"
        >
          {testing && status.kind === "scanning"
            ? zh.scanner.cameraReady
            : statusLabel(status)}
        </p>
        <div className="ml-auto flex shrink-0 gap-2">
          {torchAvailable && showViewfinder && (
            <button
              type="button"
              onClick={() => void handleTorch()}
              aria-pressed={torchOn}
              className="h-11 rounded-full bg-black/40 px-4 text-sm font-semibold"
            >
              {torchOn ? zh.scanner.flashlightOff : zh.scanner.flashlight}
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            aria-label={testing ? zh.scanner.closeCameraTest : zh.scanner.close}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-2xl leading-none"
          >
            ×
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={zh.scanner.preview}
          className={`h-full w-full object-cover ${showViewfinder ? "" : "invisible"}`}
        />

        {showViewfinder && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="h-28 w-[94%] rounded-2xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <p className="px-6 text-center text-sm text-white/90">
              {testing ? zh.scanner.testInstruction : zh.scanner.instruction}
            </p>
          </div>
        )}

        {status.kind === "cameraError" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-base font-semibold">{zh.scanner.cameraUnavailable}</p>
            <p className="text-sm text-white/80">{status.info.message}</p>
            {!testing && (
              <p className="text-sm text-white/70">{zh.scanner.cameraFallback}</p>
            )}
            {status.info.reason !== "unsupported" &&
              status.info.reason !== "noCamera" &&
              status.info.reason !== "assetsMissing" && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-1 h-11 rounded-xl bg-white/15 px-5 text-sm font-semibold"
                >
                  {zh.scanner.retryCamera}
                </button>
              )}
          </div>
        )}

        {status.kind === "recognized" && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-base font-semibold">{zh.scanner.recognized(status.raw)}</p>
          </div>
        )}

        {status.kind === "lookingUp" && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-base font-semibold">{zh.scanner.lookingUp}</p>
          </div>
        )}

        {(status.kind === "notFound" || status.kind === "lookupFailed") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-base font-semibold">
              {status.kind === "notFound"
                ? zh.scanner.productNotFoundCode(status.raw)
                : status.message}
            </p>
            <p className="font-mono text-sm break-all text-white/80">{status.raw}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(status.raw)}
                className="h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold"
              >
                {copied ? zh.scanner.copied : zh.scanner.copyCode}
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold"
              >
                {zh.scanner.scanAgain}
              </button>
              <button
                type="button"
                onClick={focusManualEntry}
                className="h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold"
              >
                {zh.scanner.manualSearch}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Anchored to the bottom so it stays within thumb reach on a phone. */}
      {!testing && (
        <form
          onSubmit={handleManualSubmit}
          className="space-y-2 border-t border-white/15 bg-porcelain-950/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <label htmlFor="manual-code" className="block text-xs text-white/70">
            {zh.scanner.manualLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="manual-code"
              type="text"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder={zh.scanner.manualPlaceholder}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-12 flex-1 rounded-xl border border-white/25 bg-white/10 px-3 text-base text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={manualValue.trim() === ""}
              className="h-12 shrink-0 rounded-xl bg-white px-5 text-base font-semibold text-porcelain-900 disabled:bg-white/30 disabled:text-white/60"
            >
              {zh.scanner.find}
            </button>
          </div>
          {rawValue !== null && status.kind !== "lookingUp" && (
            <p className="text-xs text-white/60">
              {zh.scanner.scannedKept}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
