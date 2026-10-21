import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  latestCameraDiagnostic,
  latestScanDiagnostic,
  resetCameraDiagnosticsForTests,
  resetScanDiagnosticsForTests,
} from "@/lib/offline/diagnostics";
import type { Product } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  onProduct: vi.fn(),
  scanProductsLocalFirst: vi.fn(),
  decodeFromCanvas: vi.fn(),
  getUserMedia: vi.fn(),
  frames: [] as Array<{ value: string; format?: number }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/offline/lookup", () => ({
  scanProductsLocalFirst: mocks.scanProductsLocalFirst,
}));

vi.mock("@/components/catalogue-provider", () => ({
  useCatalogue: () => ({
    products: [],
    access: {
      kind: "ready",
      meta: { lastSyncedAt: Date.now(), count: 1 },
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    },
    online: true,
  }),
}));

vi.mock("@zxing/library", () => ({
  BarcodeFormat: {
    CODE_128: 1,
    CODE_39: 2,
    EAN_13: 3,
    EAN_8: 4,
    UPC_A: 5,
    UPC_E: 6,
    QR_CODE: 7,
  },
  DecodeHintType: { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 },
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromCanvas = mocks.decodeFromCanvas;
  },
}));

// Imported after the mocks so the component picks them up.
const { default: BarcodeScanner } = await import("@/components/barcode-scanner");

let tracks: Array<{
  stop: ReturnType<typeof vi.fn>;
  kind?: string;
  label?: string;
  getCapabilities?: () => {
    torch?: boolean;
    focusMode?: string[];
    zoom?: { min: number; max: number; step: number };
    width?: { max?: number };
    height?: { max?: number };
  };
  getSettings?: () => {
    width?: number;
    height?: number;
    facingMode?: string;
    focusMode?: string;
    zoom?: number;
  };
  applyConstraints?: ReturnType<typeof vi.fn>;
}> = [];

const PRODUCT: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: null,
  unitPrice: null,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

function grantCamera() {
  mocks.getUserMedia.mockImplementation(async () => ({
    getVideoTracks: () => tracks,
    getTracks: () => tracks,
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: mocks.getUserMedia },
    configurable: true,
  });
}

function stubVideoFrame() {
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 1920,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 1080,
  });
  HTMLVideoElement.prototype.play = () => Promise.resolve();
}

async function emit(value: string, format?: number) {
  mocks.frames.push({ value, format });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

function renderScanner(props: Partial<React.ComponentProps<typeof BarcodeScanner>> = {}) {
  return render(
    <BarcodeScanner
      onClose={props.onClose ?? vi.fn()}
      onProduct={props.onProduct ?? mocks.onProduct}
      onMultipleResults={props.onMultipleResults ?? vi.fn()}
      onCameraReady={props.onCameraReady}
      purpose={props.purpose}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetScanDiagnosticsForTests();
  resetCameraDiagnosticsForTests();
  mocks.frames.length = 0;
  tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  stubVideoFrame();
  grantCamera();

  mocks.decodeFromCanvas.mockImplementation(() => {
    const next = mocks.frames.shift();
    if (!next) {
      throw Object.assign(new Error("not found"), { name: "NotFoundException" });
    }
    return {
      getText: () => next.value,
      ...(next.format === undefined ? {} : { getBarcodeFormat: () => next.format }),
    };
  });
  mocks.scanProductsLocalFirst.mockResolvedValue({
    status: "error",
    reason: "notFoundLocal",
    message: "No matching product in the offline catalogue.",
  });
});

afterEach(() => {
  cleanup();
});

describe("camera startup", () => {
  it("asks for the rear camera and reports an active status", async () => {
    renderScanner();

    expect(await screen.findByText("正在扫描条码…")).toBeVisible();
    expect(
      screen.getByText("将条码放大并保持平稳，完整显示条码两端，避免反光。"),
    ).toBeVisible();

    expect(mocks.getUserMedia.mock.calls[0][0]).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    expect(screen.queryByText(/未找到产品/)).toBeNull();
    expect(screen.queryByLabelText("放大条码")).toBeNull();

    await waitFor(() => expect(mocks.decodeFromCanvas).toHaveBeenCalled());
    const canvas = mocks.decodeFromCanvas.mock.calls[0][0] as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThanOrEqual(1600);
    expect(canvas.height).toBeGreaterThanOrEqual(900);
  });

  it("starts only one camera request", async () => {
    renderScanner();
    await screen.findByText("正在扫描条码…");
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("still scans when the high-resolution request is rejected", async () => {
    let calls = 0;
    mocks.getUserMedia.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("too big"), { name: "OverconstrainedError" });
      }
      return { getVideoTracks: () => tracks, getTracks: () => tracks };
    });

    renderScanner();
    expect(await screen.findByText("正在扫描条码…")).toBeVisible();
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe("camera unavailable", () => {
  it("explains a denied permission and keeps manual entry usable", async () => {
    mocks.getUserMedia.mockRejectedValue(
      Object.assign(new Error("nope"), { name: "NotAllowedError" }),
    );

    renderScanner();

    expect(await screen.findByText(/摄像头权限未开启/)).toBeVisible();
    expect(screen.getByLabelText(/无法扫码时，请输入产品编号或条码/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeVisible();
  });

  it("reports when the device has no camera", async () => {
    mocks.getUserMedia.mockRejectedValue(
      Object.assign(new Error("none"), { name: "NotFoundError" }),
    );

    renderScanner();

    expect(await screen.findByText("此设备没有可用的摄像头。")).toBeVisible();
  });

  it("reports when the browser exposes no camera API at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    renderScanner();

    expect(
      await screen.findByText("此浏览器无法使用摄像头。"),
    ).toBeVisible();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("successful decoding", () => {
  it("hands a single match back as a cached product, without navigating", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("K10188-13");

    await waitFor(() => {
      expect(mocks.onProduct).toHaveBeenCalledWith(PRODUCT);
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("reports the camera as ready once it is streaming", async () => {
    const onCameraReady = vi.fn();
    renderScanner({ onCameraReady });

    await screen.findByText("正在扫描条码…");
    expect(onCameraReady).toHaveBeenCalledTimes(1);
  });

  it("ignores decoded values during a camera test", async () => {
    const onCameraReady = vi.fn();
    renderScanner({ purpose: "test", onCameraReady });

    await screen.findByText("摄像头可用，已可离线扫码。");
    await emit("K10188-13");

    expect(onCameraReady).toHaveBeenCalledTimes(1);
    expect(mocks.scanProductsLocalFirst).not.toHaveBeenCalled();
    expect(mocks.onProduct).not.toHaveBeenCalled();
  });

  it("stops the camera as soon as a code is detected", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("K10188-13");

    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves the raw decoded value exactly", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "error",
      reason: "notFoundLocal",
      message: "No matching product in the offline catalogue.",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("0012345678905");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalled();
    });
    const rawValue = mocks.scanProductsLocalFirst.mock.calls[0][2];
    expect(rawValue).toBe("0012345678905");
    expect(typeof rawValue).toBe("string");
  });

  it("hands several matches back to the search page", async () => {
    const second = { ...PRODUCT, id: "other", code: "K10188-14" };
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "multiple", products: [PRODUCT, second] },
      source: "local",
    });
    const onMultipleResults = vi.fn();

    renderScanner({ onMultipleResults });
    await screen.findByText("正在扫描条码…");
    await emit("plate");

    await waitFor(() => {
      expect(onMultipleResults).toHaveBeenCalledWith("plate", [PRODUCT, second]);
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("unknown barcode", () => {
  it("shows the raw value and offers to copy it", async () => {
    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("9999999999999");

    expect(
      (await screen.findAllByText("未找到产品：9999999999999")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("9999999999999")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制编号" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeVisible();
  });
});

describe("repeated detections", () => {
  it("looks up a code only once even when the decoder keeps firing", async () => {
    renderScanner();
    await screen.findByText("正在扫描条码…");

    await emit("4901234567894");
    await emit("4901234567894");
    await emit("4901234567894");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores a different code once one has been handled", async () => {
    renderScanner();
    await screen.findByText("正在扫描条码…");

    await emit("1111111111111");
    await emit("2222222222222");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalledTimes(1);
    });
    expect(mocks.scanProductsLocalFirst.mock.calls[0][2]).toBe("1111111111111");
  });

  it("accepts a new code immediately after rescan", async () => {
    renderScanner();
    await screen.findByText("正在扫描条码…");

    await emit("1111111111111");
    expect(
      (await screen.findAllByText("未找到产品：1111111111111")).length,
    ).toBeGreaterThan(0);

    await act(async () => {
      screen.getByRole("button", { name: "重新扫描" }).click();
    });
    await screen.findByText("正在扫描条码…");
    await emit("2222222222222");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalledTimes(2);
    });
    expect(mocks.scanProductsLocalFirst.mock.calls[1][2]).toBe("2222222222222");
  });
});

describe("cleanup", () => {
  it("releases every MediaStream track on unmount", async () => {
    const view = renderScanner();
    await screen.findByText("正在扫描条码…");

    view.unmount();

    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("releases the camera when the user closes the scanner", async () => {
    const onClose = vi.fn();
    renderScanner({ onClose });
    await screen.findByText("正在扫描条码…");

    await act(async () => {
      screen.getByRole("button", { name: "关闭" }).click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});

describe("manual entry", () => {
  it("looks up a typed code without the camera", async () => {
    mocks.getUserMedia.mockRejectedValue(
      Object.assign(new Error("nope"), { name: "NotAllowedError" }),
    );
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });
    // The typed path resolves locally too, so no navigation is involved.

    renderScanner();
    await screen.findByText(/摄像头权限未开启/);

    const input = screen.getByLabelText(/无法扫码时，请输入产品编号或条码/);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "K10188-13");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      screen.getByRole("button", { name: "搜索" }).click();
    });

    await waitFor(() => {
      expect(mocks.onProduct).toHaveBeenCalledWith(PRODUCT);
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("scan stages", () => {
  it("shows the decoded code before it starts looking the product up", async () => {
    let resolveLookup: (value: {
      status: "error";
      reason: "notFoundLocal";
      message: string;
    }) => void = () => {};
    mocks.scanProductsLocalFirst.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
    );

    renderScanner();
    await screen.findByText("正在扫描条码…");
    expect(screen.queryByText(/未找到产品/)).toBeNull();
    await emit("TT2101");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalled();
    });
    expect(mocks.scanProductsLocalFirst.mock.calls[0][2]).toBe("TT2101");
    expect(
      screen.queryAllByText("已识别：TT2101").length +
        screen.queryAllByText("正在查找产品…").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/未找到产品/)).toBeNull();

    await act(async () => {
      resolveLookup({
        status: "error",
        reason: "notFoundLocal",
        message: "missing",
      });
    });

    expect(
      (await screen.findAllByText("未找到产品：TT2101")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeVisible();
    expect(screen.getByRole("button", { name: "手动输入" })).toBeVisible();
  });

  it("offers retry and manual search when lookup fails", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "error",
      reason: "network",
      message: "资料载入失败，请重试。",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("KU0509-GR");

    expect(
      (await screen.findAllByText("资料载入失败，请重试。")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeVisible();
    await act(async () => {
      screen.getByRole("button", { name: "手动输入" }).click();
    });
    expect(screen.getByLabelText(/无法扫码时，请输入产品编号或条码/)).toHaveFocus();
  });

  it("records a Code 39 decode and a Code 128 decode", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("K10188-13", 2);

    await waitFor(() => {
      expect(mocks.onProduct).toHaveBeenCalledWith(PRODUCT);
    });
    expect(latestScanDiagnostic()).toMatchObject({
      decodedValue: "K10188-13",
      format: "CODE_39",
      lookupSource: "local",
      result: "product",
    });
    expect(latestScanDiagnostic()?.decodeMs).toBeGreaterThanOrEqual(0);
    expect(latestScanDiagnostic()?.lookupMs).toBeGreaterThanOrEqual(0);
  });

  it("records a Code 128 decode of a numeric code", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: { ...PRODUCT, code: "78032268" } },
      source: "local",
    });

    renderScanner();
    await screen.findByText("正在扫描条码…");
    await emit("78032268", 1);

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalled();
    });
    expect(mocks.scanProductsLocalFirst.mock.calls[0][2]).toBe("78032268");
    expect(latestScanDiagnostic()).toMatchObject({
      decodedValue: "78032268",
      format: "CODE_128",
      lookupSource: "local",
      result: "product",
    });
  });
});

describe("small barcode help", () => {
  it("shows zoom and refocus when the camera supports them", async () => {
    const apply = vi.fn(async () => undefined);
    tracks = [
      {
        stop: vi.fn(),
        kind: "video",
        label: "Back Camera",
        getCapabilities: () => ({
          zoom: { min: 1, max: 4, step: 0.5 },
          focusMode: ["continuous"],
          width: { max: 1920 },
          height: { max: 1080 },
        }),
        getSettings: () => ({
          width: 1920,
          height: 1080,
          facingMode: "environment",
          focusMode: "continuous",
          zoom: 1,
        }),
        applyConstraints: apply,
      },
    ];

    renderScanner();
    const slider = await screen.findByRole("slider", { name: "放大条码" });
    expect(screen.getByText("条码太小时，可适当放大")).toBeVisible();
    expect(slider).toHaveAttribute("max", "4");
    expect(slider).toHaveAttribute("min", "1");
    expect(Number((slider as HTMLInputElement).value)).toBeGreaterThan(1);
    expect(Number((slider as HTMLInputElement).value)).toBeLessThanOrEqual(4);
    expect(screen.getByRole("button", { name: "重新对焦" })).toBeVisible();
    expect(latestCameraDiagnostic()).toMatchObject({
      requestedWidth: 1920,
      requestedHeight: 1080,
      width: 1920,
      height: 1080,
      facingMode: "environment",
      focusMode: "continuous",
      deviceLabel: "Back Camera",
    });

    await act(async () => {
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(slider, "3");
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith({ advanced: [{ zoom: 3 }] });
    });
  });

  it("explains an undecoded scan without saying the product is missing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      renderScanner();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });
      expect(screen.getByText("正在扫描条码…")).toBeVisible();
      expect(screen.queryByText(/未找到产品/)).toBeNull();
      expect(mocks.scanProductsLocalFirst).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(
        screen.getByText("暂未识别，请尝试靠近、放大、重新对焦或避免反光。"),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "重新扫描" })).toBeVisible();
      expect(screen.getByRole("button", { name: "手动输入" })).toBeVisible();
      expect(mocks.scanProductsLocalFirst).not.toHaveBeenCalled();
      expect(screen.queryByText(/未找到产品/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("camera aids", () => {
  it("enables continuous focus and a flashlight when the camera supports them", async () => {
    const applyConstraints = vi.fn(async () => undefined);
    tracks = [
      {
        stop: vi.fn(),
        kind: "video",
        getCapabilities: () => ({ torch: true, focusMode: ["continuous"] }),
        applyConstraints,
      },
    ];

    renderScanner();
    await screen.findByText("正在扫描条码…");

    await waitFor(() => {
      expect(applyConstraints).toHaveBeenCalledWith({
        advanced: [{ focusMode: "continuous" }],
      });
    });

    await act(async () => {
      screen.getByRole("button", { name: "手电筒" }).click();
    });

    await waitFor(() => {
      expect(applyConstraints).toHaveBeenCalledWith({
        advanced: [{ torch: true }],
      });
    });
    expect(screen.getByRole("button", { name: "关闭手电筒" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
