import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  scanProductsLocalFirst: vi.fn(),
  decodeFromConstraints: vi.fn(),
  controlsStop: vi.fn(),
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
    decodeFromConstraints = mocks.decodeFromConstraints;
  },
}));

// Imported after the mocks so the component picks them up.
const { default: BarcodeScanner } = await import("@/components/barcode-scanner");

type DecodeCallback = (result: { getText: () => string } | undefined) => void;

let decodeCallback: DecodeCallback | null = null;
let tracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];

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

function attachFakeStream(video: HTMLVideoElement) {
  Object.defineProperty(video, "srcObject", {
    value: { getTracks: () => tracks },
    writable: true,
    configurable: true,
  });
}

function grantCamera() {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
}

async function emit(value: string) {
  await act(async () => {
    decodeCallback?.({ getText: () => value });
  });
}

function renderScanner(props: Partial<React.ComponentProps<typeof BarcodeScanner>> = {}) {
  return render(
    <BarcodeScanner
      onClose={props.onClose ?? vi.fn()}
      onMultipleResults={props.onMultipleResults ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  decodeCallback = null;
  tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  grantCamera();

  mocks.decodeFromConstraints.mockImplementation(
    async (_constraints: unknown, video: HTMLVideoElement, cb: DecodeCallback) => {
      decodeCallback = cb;
      attachFakeStream(video);
      return { stop: mocks.controlsStop };
    },
  );
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

    expect(await screen.findByText("Camera active — point at a barcode")).toBeVisible();
    expect(screen.getByText("Hold the barcode inside the frame.")).toBeVisible();

    const [constraints] = mocks.decodeFromConstraints.mock.calls[0];
    expect(constraints).toEqual({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  });

  it("starts only one decode loop", async () => {
    renderScanner();
    await screen.findByText("Camera active — point at a barcode");
    expect(mocks.decodeFromConstraints).toHaveBeenCalledTimes(1);
  });
});

describe("camera unavailable", () => {
  it("explains a denied permission and keeps manual entry usable", async () => {
    mocks.decodeFromConstraints.mockRejectedValue(
      Object.assign(new Error("nope"), { name: "NotAllowedError" }),
    );

    renderScanner();

    expect(await screen.findByText(/Camera access was blocked/)).toBeVisible();
    expect(screen.getByLabelText(/Enter the code or barcode/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close scanner" })).toBeVisible();
  });

  it("reports when the device has no camera", async () => {
    mocks.decodeFromConstraints.mockRejectedValue(
      Object.assign(new Error("none"), { name: "NotFoundError" }),
    );

    renderScanner();

    expect(await screen.findByText("No camera was found on this device.")).toBeVisible();
  });

  it("reports when the browser exposes no camera API at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: undefined,
      configurable: true,
    });

    renderScanner();

    expect(
      await screen.findByText("This browser does not provide camera access."),
    ).toBeVisible();
    expect(mocks.decodeFromConstraints).not.toHaveBeenCalled();
  });
});

describe("successful decoding", () => {
  it("navigates straight to a single matching product", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText("Camera active — point at a barcode");
    await emit("K10188-13");

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/products/K10188-13");
    });
  });

  it("stops the camera as soon as a code is detected", async () => {
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText("Camera active — point at a barcode");
    await emit("K10188-13");

    expect(mocks.controlsStop).toHaveBeenCalled();
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
    await screen.findByText("Camera active — point at a barcode");
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
    await screen.findByText("Camera active — point at a barcode");
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
    await screen.findByText("Camera active — point at a barcode");
    await emit("9999999999999");

    expect(
      await screen.findByText("No product found for barcode: 9999999999999"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeVisible();
  });
});

describe("repeated detections", () => {
  it("looks up a code only once even when the decoder keeps firing", async () => {
    renderScanner();
    await screen.findByText("Camera active — point at a barcode");

    await emit("4901234567894");
    await emit("4901234567894");
    await emit("4901234567894");

    await waitFor(() => {
      expect(mocks.scanProductsLocalFirst).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores a different code once one has been handled", async () => {
    renderScanner();
    await screen.findByText("Camera active — point at a barcode");

    await emit("1111111111111");
    await emit("2222222222222");

    expect(mocks.scanProductsLocalFirst).toHaveBeenCalledTimes(1);
    expect(mocks.scanProductsLocalFirst.mock.calls[0][2]).toBe("1111111111111");
  });
});

describe("cleanup", () => {
  it("releases every MediaStream track on unmount", async () => {
    const view = renderScanner();
    await screen.findByText("Camera active — point at a barcode");

    view.unmount();

    expect(mocks.controlsStop).toHaveBeenCalled();
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("releases the camera when the user closes the scanner", async () => {
    const onClose = vi.fn();
    renderScanner({ onClose });
    await screen.findByText("Camera active — point at a barcode");

    await act(async () => {
      screen.getByRole("button", { name: "Close scanner" }).click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});

describe("manual entry", () => {
  it("looks up a typed code without the camera", async () => {
    mocks.decodeFromConstraints.mockRejectedValue(
      Object.assign(new Error("nope"), { name: "NotAllowedError" }),
    );
    mocks.scanProductsLocalFirst.mockResolvedValue({
      status: "match",
      match: { kind: "single", product: PRODUCT },
      source: "local",
    });

    renderScanner();
    await screen.findByText(/Camera access was blocked/);

    const input = screen.getByLabelText(/Enter the code or barcode/);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "K10188-13");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      screen.getByRole("button", { name: "Find" }).click();
    });

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/products/K10188-13");
    });
  });
});
