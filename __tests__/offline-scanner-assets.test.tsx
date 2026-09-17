import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * When the decoder chunks were never cached, the scanner must say so instead
 * of reporting a generic camera failure. Both `@zxing/*` factories reject the
 * way an offline dynamic import does.
 */

vi.mock("@zxing/browser", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

vi.mock("@zxing/library", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

vi.mock("@/components/catalogue-provider", () => ({
  useCatalogue: () => ({
    products: [],
    access: { kind: "missing" },
    online: false,
  }),
}));

const { default: BarcodeScanner } = await import("@/components/barcode-scanner");
const { SCANNER_ASSETS_MISSING } = await import("@/lib/barcode");
const { preloadScannerAssets, resetScannerPreloadForTests } = await import(
  "@/lib/offline/scanner-assets"
);

afterEach(() => {
  cleanup();
  resetScannerPreloadForTests();
});

describe("missing scanner chunks", () => {
  it("names the missing download instead of blaming the camera", async () => {
    render(<BarcodeScanner onClose={vi.fn()} />);

    expect(await screen.findByText(SCANNER_ASSETS_MISSING.message)).toBeVisible();
    expect(screen.queryByText("The camera could not be started.")).toBeNull();
  });

  it("offers no retry that cannot succeed offline", async () => {
    render(<BarcodeScanner onClose={vi.fn()} />);

    await screen.findByText(SCANNER_ASSETS_MISSING.message);
    expect(screen.queryByRole("button", { name: "Try the camera again" })).toBeNull();
  });

  it("reports a failed preload as unfinished rather than ready", async () => {
    await expect(preloadScannerAssets()).resolves.toBe(false);
  });
});
