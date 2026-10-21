import { describe, expect, it, vi } from "vitest";
import {
  barcodeFormatLabel,
  BASIC_CAMERA_CONSTRAINTS,
  buildDecodeHints,
  clampZoom,
  decodeVideoFrames,
  defaultZoom,
  describeCameraError,
  frameSizeForPass,
  hasCameraSupport,
  openScanCamera,
  preferScanResolution,
  PRIMARY_FORMAT_NAME,
  readZoomRange,
  REAR_CAMERA_CONSTRAINTS,
  refreshCameraFocus,
  resolveScanMatch,
  setCameraTorch,
  setCameraZoom,
  stopMediaStream,
  SUPPORTED_FORMAT_NAMES,
  tuneScanCamera,
} from "@/lib/barcode";
import type { Product } from "@/lib/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "K10188-13",
    nameZh: "大方盘·紫",
    nameEn: "Abbesses Plate - L",
    dimensions: "20.6 × 13.3 × 2.0 cm",
    barcode: null,
    unitPrice: null,
    packaging: null,
    currency: "USD",
    imageUrl: null,
    ...overrides,
  };
}

describe("buildDecodeHints", () => {
  const DecodeHintType = { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 };
  const BarcodeFormat = {
    CODE_39: 10,
    CODE_128: 11,
    EAN_13: 12,
    EAN_8: 13,
    UPC_A: 14,
    UPC_E: 15,
    QR_CODE: 16,
    PDF_417: 99,
  };

  it("lists Code 39 first, as Koei's own label format", () => {
    expect(PRIMARY_FORMAT_NAME).toBe("CODE_39");
    expect(SUPPORTED_FORMAT_NAMES[0]).toBe("CODE_39");

    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as number[];
    expect(formats[0]).toBe(BarcodeFormat.CODE_39);
  });

  it("keeps Code 128, EAN, UPC and QR enabled as fallbacks", () => {
    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    const formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as number[];

    expect(formats).toHaveLength(SUPPORTED_FORMAT_NAMES.length);
    for (const name of ["CODE_128", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "QR_CODE"]) {
      expect(formats).toContain(BarcodeFormat[name as keyof typeof BarcodeFormat]);
    }
    expect(formats).not.toContain(BarcodeFormat.PDF_417);
  });

  it("enables TRY_HARDER", () => {
    const hints = buildDecodeHints(DecodeHintType, BarcodeFormat);
    expect(hints.get(DecodeHintType.TRY_HARDER)).toBe(true);
  });
});

describe("Code 39 label scanned from a Koei product", () => {
  // Confirmed from the legacy system: the label on K10188-13 is a Code 39
  // graphic generated from the product code, and decodes to exactly that.
  const CODE_39_DECODED = "K10188-13";

  it("resolves the K10188-13 product from its Code 39 value", () => {
    const k10188 = product({ code: "K10188-13", barcode: null });

    expect(resolveScanMatch(CODE_39_DECODED, [k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });

  it("keeps the hyphen and does not treat the value as a number", () => {
    expect(CODE_39_DECODED).toContain("-");
    expect(Number.isNaN(Number(CODE_39_DECODED))).toBe(true);

    const k10188 = product({ code: "K10188-13" });
    const match = resolveScanMatch(CODE_39_DECODED, [k10188]);

    expect(match.kind).toBe("single");
    expect(CODE_39_DECODED).toBe("K10188-13");
  });

  it("still resolves when the label is read in a different case", () => {
    const k10188 = product({ code: "K10188-13" });
    expect(resolveScanMatch("k10188-13", [k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });

  it("wins over another product whose barcode column holds the same value", () => {
    const k10188 = product({ id: "code-row", code: "K10188-13", barcode: null });
    const supplierRow = product({
      id: "barcode-row",
      code: "SUP-991",
      barcode: "K10188-13",
    });

    expect(resolveScanMatch(CODE_39_DECODED, [supplierRow, k10188])).toEqual({
      kind: "single",
      product: k10188,
    });
  });
});

describe("resolveScanMatch", () => {
  it("returns none when nothing came back", () => {
    expect(resolveScanMatch("123", [])).toEqual({ kind: "none" });
  });

  it("treats a single exact barcode match as a direct hit", () => {
    const target = product({ barcode: "4901234567894" });
    const other = product({ id: "b", code: "OTHER-1" });
    const match = resolveScanMatch("4901234567894", [other, target]);

    expect(match).toEqual({ kind: "single", product: target });
  });

  it("matches on product code as well as barcode", () => {
    const target = product();
    expect(resolveScanMatch("K10188-13", [target])).toEqual({
      kind: "single",
      product: target,
    });
  });

  it("compares case-insensitively without altering the raw value", () => {
    const target = product();
    const raw = "k10188-13";
    expect(resolveScanMatch(raw, [target])).toEqual({ kind: "single", product: target });
    expect(raw).toBe("k10188-13");
  });

  it("returns multiple when several products match loosely", () => {
    const a = product({ id: "a", code: "A-1" });
    const b = product({ id: "b", code: "B-2" });
    expect(resolveScanMatch("plate", [a, b])).toEqual({
      kind: "multiple",
      products: [a, b],
    });
  });

  it("returns multiple when two products claim the same exact value", () => {
    const a = product({ id: "a", code: "DUP" });
    const b = product({ id: "b", code: "dup" });
    expect(resolveScanMatch("DUP", [a, b]).kind).toBe("multiple");
  });

  it("treats a lone loose result as a direct hit", () => {
    const only = product({ code: "ZZZ-9" });
    expect(resolveScanMatch("Abbesses", [only])).toEqual({
      kind: "single",
      product: only,
    });
  });
});

describe("describeCameraError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["PermissionDeniedError", "denied"],
    ["NotFoundError", "noCamera"],
    ["OverconstrainedError", "noCamera"],
    ["NotReadableError", "inUse"],
    ["SecurityError", "insecure"],
    ["SomethingElse", "unknown"],
  ])("maps %s to %s", (name, reason) => {
    expect(describeCameraError({ name }).reason).toBe(reason);
  });

  it("handles non-error values", () => {
    expect(describeCameraError(undefined).reason).toBe("unknown");
    expect(describeCameraError("boom").reason).toBe("unknown");
  });
});

describe("hasCameraSupport", () => {
  it("is false when mediaDevices is missing", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    expect(hasCameraSupport()).toBe(false);

    if (original) Object.defineProperty(navigator, "mediaDevices", original);
  });

  it("is true when getUserMedia exists", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });

    expect(hasCameraSupport()).toBe(true);
  });
});

describe("camera focus and flashlight", () => {
  it("requests the rear camera at 1080p without making focus a startup requirement", () => {
    expect(REAR_CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  });

  it("names Code 39 and Code 128 when the decoder reports them", () => {
    const formats = { CODE_39: 10, CODE_128: 11, QR_CODE: 16 };
    expect(barcodeFormatLabel(10, formats)).toBe("CODE_39");
    expect(barcodeFormatLabel(11, formats)).toBe("CODE_128");
    expect(barcodeFormatLabel(99, formats)).toBeNull();
    expect(barcodeFormatLabel(undefined, formats)).toBeNull();
  });

  it("applies continuous focus and reports a torch only when the track supports them", async () => {
    const apply = vi.fn(async () => undefined);
    const supported = {
      kind: "video",
      getCapabilities: () => ({ focusMode: ["continuous"], torch: true }),
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;

    await expect(tuneScanCamera(supported)).resolves.toEqual({
      torch: true,
      zoom: null,
      canRefreshFocus: true,
    });
    expect(apply).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] });

    const plain = { kind: "video", stop() {} } as unknown as MediaStreamTrack;
    await expect(tuneScanCamera(plain)).resolves.toEqual({
      torch: false,
      zoom: null,
      canRefreshFocus: false,
    });
    await expect(tuneScanCamera(undefined)).resolves.toEqual({
      torch: false,
      zoom: null,
      canRefreshFocus: false,
    });
  });

  it("toggles the torch and treats a rejected constraint as unsupported", async () => {
    const apply = vi.fn(async () => undefined);
    const track = {
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;

    await expect(setCameraTorch(track, true)).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith({ advanced: [{ torch: true }] });

    apply.mockRejectedValueOnce(new Error("unsupported"));
    await expect(setCameraTorch(track, false)).resolves.toBe(false);
    await expect(setCameraTorch(undefined, true)).resolves.toBe(false);
  });
});

describe("camera capabilities", () => {
  it("reads a zoom range and ignores devices that do not expose one", () => {
    expect(readZoomRange({ zoom: { min: 1, max: 4, step: 0.1 } })).toEqual({
      min: 1,
      max: 4,
      step: 0.1,
    });
    expect(readZoomRange({})).toBeNull();
    expect(readZoomRange({ zoom: true })).toBeNull();
    expect(readZoomRange(undefined)).toBeNull();
  });

  it("keeps a moderate default inside the reported range", () => {
    const range = { min: 1, max: 5, step: 0.5 };
    const chosen = defaultZoom(range);
    expect(chosen).toBeGreaterThan(range.min);
    expect(chosen).toBeLessThan(range.max);
    expect(chosen).toBe(clampZoom(chosen, range));
    expect(clampZoom(99, range)).toBe(range.max);
    expect(clampZoom(0, range)).toBe(range.min);
  });

  it("applies zoom only within the device range", async () => {
    const apply = vi.fn(async () => undefined);
    const track = { applyConstraints: apply } as unknown as MediaStreamTrack;
    const range = { min: 1, max: 3, step: 0.5 };

    await expect(setCameraZoom(track, 2.2, range)).resolves.toBe(2);
    expect(apply).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });

    apply.mockRejectedValueOnce(new Error("unsupported"));
    await expect(setCameraZoom(track, 2, range)).resolves.toBeNull();
    await expect(setCameraZoom(undefined, 2, range)).resolves.toBeNull();
  });

  it("falls back when the detailed camera request is rejected", async () => {
    const request = vi.fn(async (constraints: MediaStreamConstraints) => {
      const video = constraints.video;
      if (video && typeof video === "object" && "width" in video) {
        throw Object.assign(new Error("too big"), { name: "OverconstrainedError" });
      }
      return { id: "opened" } as unknown as MediaStream;
    });

    const opened = await openScanCamera(request);
    expect(opened.stream).toEqual({ id: "opened" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  });

  it("does not retry after a permission denial", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    });
    await expect(openScanCamera(request)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("uses any camera when the rear camera cannot satisfy a constraint", async () => {
    const request = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video !== true) {
        throw Object.assign(new Error("no match"), { name: "OverconstrainedError" });
      }
      return { id: "basic" } as unknown as MediaStream;
    });
    const opened = await openScanCamera(request);
    expect(opened.constraints).toEqual(BASIC_CAMERA_CONSTRAINTS);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps a 1080p detail frame and does not shrink a small frame", () => {
    expect(frameSizeForPass(1920, 1080, "detail")).toEqual({
      width: 1920,
      height: 1080,
      downscaled: false,
    });
    expect(frameSizeForPass(1920, 1080, "normal")).toEqual({
      width: 1600,
      height: 900,
      downscaled: true,
    });
    expect(frameSizeForPass(640, 480, "detail")).toEqual({
      width: 640,
      height: 480,
      downscaled: false,
    });
    expect(frameSizeForPass(640, 480, "normal")).toEqual({
      width: 640,
      height: 480,
      downscaled: false,
    });
    const detail = frameSizeForPass(1920, 1080, "detail");
    expect(Math.max(detail.width, detail.height)).toBeGreaterThanOrEqual(1600);
  });

  it("decodes one frame at a time, then a detail frame, and stops at the first text", async () => {
    const passes: string[] = [];
    let active = 0;
    let maxActive = 0;
    const decoded: string[] = [];

    await decodeVideoFrames({
      stopped: () => false,
      gapMs: 0,
      sleep: async () => {},
      nextFrame: async (pass) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        passes.push(pass);
        await Promise.resolve();
        active -= 1;
        if (pass === "detail") return { text: "78032268", format: "CODE_128" };
        return null;
      },
      onDecoded: (frame) => decoded.push(frame.text),
    });

    expect(maxActive).toBe(1);
    expect(passes).toEqual(["normal", "normal", "detail"]);
    expect(decoded).toEqual(["78032268"]);
  });

  it("refreshes focus only when the track offers a safe mode", async () => {
    const apply = vi.fn(async () => undefined);
    const supported = {
      getCapabilities: () => ({ focusMode: ["single-shot", "continuous"] }),
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;

    await expect(refreshCameraFocus(supported)).resolves.toBe(true);
    expect(apply).toHaveBeenNthCalledWith(1, { advanced: [{ focusMode: "single-shot" }] });
    expect(apply).toHaveBeenNthCalledWith(2, { advanced: [{ focusMode: "continuous" }] });

    apply.mockRejectedValueOnce(new Error("busy"));
    await expect(refreshCameraFocus(supported)).resolves.toBe(false);
    await expect(refreshCameraFocus(undefined)).resolves.toBe(false);
  });

  it("ignores a resolution upgrade the camera rejects", async () => {
    const apply = vi.fn(async () => {
      throw Object.assign(new Error("no"), { name: "OverconstrainedError" });
    });
    const track = {
      getCapabilities: () => ({ width: { max: 1280 }, height: { max: 720 } }),
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;

    await expect(preferScanResolution(track)).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledWith({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });
});

describe("stopMediaStream", () => {
  it("stops every track and detaches the stream", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const video = document.createElement("video");
    Object.defineProperty(video, "srcObject", {
      value: { getTracks: () => [{ stop: stopA }, { stop: stopB }] },
      writable: true,
      configurable: true,
    });

    expect(stopMediaStream(video)).toBe(2);
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("is safe with no element and no stream", () => {
    expect(stopMediaStream(null)).toBe(0);

    const video = document.createElement("video");
    Object.defineProperty(video, "srcObject", {
      value: null,
      writable: true,
      configurable: true,
    });
    expect(stopMediaStream(video)).toBe(0);
  });
});
