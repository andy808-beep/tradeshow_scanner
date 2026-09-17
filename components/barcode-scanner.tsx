"use client";

import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalogue } from "@/components/catalogue-provider";
import {
  buildDecodeHints,
  CAMERA_UNSUPPORTED,
  describeCameraError,
  hasCameraSupport,
  REAR_CAMERA_CONSTRAINTS,
  SCANNER_ASSETS_MISSING,
  stopMediaStream,
  type CameraErrorInfo,
} from "@/lib/barcode";
import { scanProductsLocalFirst } from "@/lib/offline/lookup";
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
  | { kind: "lookingUp"; raw: string }
  | { kind: "notFound"; raw: string }
  | { kind: "lookupFailed"; raw: string; message: string }
  | { kind: "cameraError"; info: CameraErrorInfo };

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

const STATUS_LABELS: Record<Status["kind"], string> = {
  starting: "Starting camera…",
  scanning: "Camera active — point at a barcode",
  lookingUp: "Looking up product…",
  notFound: "No match",
  lookupFailed: "Lookup failed",
  cameraError: "Camera unavailable",
};

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
  /** Guards against the decode loop reporting the same code repeatedly. */
  const handledRef = useRef(false);

  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [manualValue, setManualValue] = useState("");
  const [copied, setCopied] = useState(false);
  /** Bumped to restart the camera after a retry. */
  const [session, setSession] = useState(0);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    stopMediaStream(videoRef.current);
  }, []);

  const lookUp = useCallback(
    async (rawValue: string) => {
      handledRef.current = true;
      stopCamera();
      setStatus({ kind: "lookingUp", raw: rawValue });

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await scanProductsLocalFirst(
          catalogue,
          access,
          rawValue,
          controller.signal,
          online,
        );

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
        if (controller.signal.aborted) return;
        setStatus({
          kind: "lookupFailed",
          raw: rawValue,
          message:
            error instanceof Error
              ? error.message
              : "The product database is not available.",
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

        // Requests camera permission — only ever reached after the user
        // pressed Scan or Test camera, because this component mounts on that
        // press.
        controls = await reader.decodeFromConstraints(
          REAR_CAMERA_CONSTRAINTS,
          video,
          (result) => {
            if (!result || handledRef.current) return;
            if (purposeRef.current === "test") return;
            void lookUpRef.current(result.getText());
          },
        );

        controlsRef.current = controls;

        if (cancelled) {
          controls.stop();
          controlsRef.current = null;
          stopMediaStream(video);
          return;
        }

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
      abortRef.current?.abort();
    };
  }, []);

  function handleClose() {
    stopCamera();
    abortRef.current?.abort();
    onClose();
  }

  function handleRetry() {
    handledRef.current = false;
    setCopied(false);
    setStatus({ kind: "starting" });
    setSession((value) => value + 1);
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
      aria-label={testing ? "Camera test" : "Barcode scanner"}
      className="fixed inset-0 z-50 flex flex-col bg-porcelain-950 text-white"
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <p
          aria-live="polite"
          className="rounded-full bg-black/40 px-3 py-1.5 text-sm font-medium"
        >
          {testing && status.kind === "scanning"
            ? "Camera works — offline scanning is ready"
            : STATUS_LABELS[status.kind]}
        </p>
        <button
          type="button"
          onClick={handleClose}
          aria-label={testing ? "Close camera test" : "Close scanner"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera preview"
          className={`h-full w-full object-cover ${showViewfinder ? "" : "invisible"}`}
        />

        {showViewfinder && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="h-44 w-[78%] rounded-2xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <p className="px-6 text-center text-sm text-white/90">
              {testing
                ? "Close this when you can see the camera picture."
                : "Hold the barcode inside the frame."}
            </p>
          </div>
        )}

        {status.kind === "cameraError" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-base font-semibold">Camera unavailable</p>
            <p className="text-sm text-white/80">{status.info.message}</p>
            {!testing && (
              <p className="text-sm text-white/70">
                You can still type a code below, or close the scanner and use search.
              </p>
            )}
            {status.info.reason !== "unsupported" &&
              status.info.reason !== "noCamera" &&
              status.info.reason !== "assetsMissing" && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-1 h-11 rounded-xl bg-white/15 px-5 text-sm font-semibold"
                >
                  Try the camera again
                </button>
              )}
          </div>
        )}

        {status.kind === "lookingUp" && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <p className="text-sm text-white/85">
              Looking up{" "}
              <span className="font-mono break-all">{status.raw}</span>…
            </p>
          </div>
        )}

        {(status.kind === "notFound" || status.kind === "lookupFailed") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-base font-semibold">
              {status.kind === "notFound"
                ? `No product found for barcode: ${status.raw}`
                : status.message}
            </p>
            <p className="font-mono text-sm break-all text-white/80">{status.raw}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCopy(status.raw)}
                className="h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold"
              >
                {copied ? "Copied" : "Copy code"}
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold"
              >
                Scan again
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
            Can’t scan? Enter the code or barcode
          </label>
          <div className="flex gap-2">
            <input
              id="manual-code"
              type="text"
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="e.g. K10188-13"
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
              Find
            </button>
          </div>
          {rawValue !== null && status.kind !== "lookingUp" && (
            <p className="text-xs text-white/60">
              Scanned value kept exactly as decoded.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
