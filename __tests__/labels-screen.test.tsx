import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/types";
import { DEFAULT_LABEL_LAYOUT } from "@/lib/label-layout";

const mocks = vi.hoisted(() => ({
  listLabelProductsRequest: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  listLabelProductsRequest: mocks.listLabelProductsRequest,
}));

const { default: LabelsScreen } = await import("@/components/labels-screen");
const { default: LabelSheet } = await import("@/components/label-sheet");
const { default: Code39Barcode } = await import("@/components/code39-barcode");

const K10188: Product = {
  id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
  code: "K10188-13",
  nameZh: "大方盘·紫",
  nameEn: "Abbesses Plate - L",
  dimensions: "20.6 × 13.3 × 2.0 cm",
  barcode: null,
  unitPrice: 12.3456,
  packaging: null,
  currency: "USD",
  imageUrl: null,
};

const INVALID: Product = {
  ...K10188,
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  code: "k-lowercase",
  nameZh: "无效",
  nameEn: "Invalid",
  unitPrice: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLabelProductsRequest.mockResolvedValue([K10188, INVALID]);
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-print-preview");
});

describe("exact encoded value on the barcode", () => {
  it("stamps K10188-13 on the SVG so a scan reads the product code", () => {
    const { container } = render(
      <Code39Barcode value="K10188-13" moduleMm={0.25} heightMm={14} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-encoded-value")).toBe("K10188-13");
    expect(svg?.getAttribute("data-barcode-format")).toBe("CODE39");
    expect(svg?.getAttribute("aria-label")).toContain("K10188-13");
    expect(container.textContent).not.toMatch(/12\.3456/);
  });
});

describe("printed label content", () => {
  it("shows code, names and dimensions, but never the unit price", () => {
    const { container } = render(
      <LabelSheet products={[K10188]} layout={DEFAULT_LABEL_LAYOUT} />,
    );

    expect(container.textContent).toContain("K10188-13");
    expect(container.textContent).toContain("大方盘·紫");
    expect(container.textContent).toContain("Abbesses Plate - L");
    expect(container.textContent).toContain("20.6 × 13.3 × 2.0 cm");
    expect(container.textContent).not.toContain("12.3456");
    expect(container.textContent).not.toContain("US$");
    expect(container.querySelector("[data-unit-price]")?.getAttribute("data-unit-price")).toBe(
      "",
    );
    expect(container.querySelector(".label-card")).toBeTruthy();
  });

  it("repeats a product once per copy", () => {
    const { container } = render(
      <LabelSheet products={[K10188, K10188]} layout={DEFAULT_LABEL_LAYOUT} />,
    );
    expect(container.querySelectorAll("[data-product-code='K10188-13']")).toHaveLength(2);
  });

  it("surfaces an invalid code instead of drawing a barcode", () => {
    render(<LabelSheet products={[INVALID]} layout={DEFAULT_LABEL_LAYOUT} />);
    expect(screen.getByText(/Cannot encode/)).toBeVisible();
    expect(screen.queryByRole("img", { name: /Code 39 barcode/ })).toBeNull();
  });
});

describe("print-only layout", () => {
  it("marks chrome and controls so print CSS can hide them", async () => {
    render(<LabelsScreen />);
    await waitFor(() => expect(mocks.listLabelProductsRequest).toHaveBeenCalled());

    expect(document.querySelector(".print-controls")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Print preview" })).toBeVisible();
  });

  it("keeps labels from splitting across pages and preserves black/white bars", () => {
    const css = readFileSync(
      path.join(process.cwd(), "app", "globals.css"),
      "utf8",
    );

    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/break-inside:\s*avoid/);
    expect(css).toMatch(/print-color-adjust:\s*exact/);
    expect(css).toMatch(/\.print-chrome/);
    expect(css).toMatch(/\.print-controls/);
    expect(css).toMatch(/background:\s*#fff/);
    expect(css).toMatch(/color:\s*#000/);
  });

  it("puts the page into print-preview mode without printing", async () => {
    render(<LabelsScreen />);
    await waitFor(() => expect(screen.getByLabelText("Select K10188-13")).toBeTruthy());

    await act(async () => {
      screen.getByLabelText("Select K10188-13").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Print preview" }).click();
    });

    expect(document.documentElement.dataset.printPreview).toBe("true");
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeVisible();
  });
});

describe("selection and copies in the page", () => {
  it("selects one product and all search results", async () => {
    render(<LabelsScreen />);
    await waitFor(() => expect(screen.getByLabelText("Select K10188-13")).toBeTruthy());

    await act(async () => {
      screen.getByLabelText("Select K10188-13").click();
    });
    expect((screen.getByLabelText("Select K10188-13") as HTMLInputElement).checked).toBe(
      true,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Select all search results" }).click();
    });
    expect((screen.getByLabelText("Select k-lowercase") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("honours the copy count on the sheet", async () => {
    const { container } = render(<LabelsScreen />);
    await waitFor(() => expect(screen.getByLabelText("Select K10188-13")).toBeTruthy());

    await act(async () => {
      screen.getByLabelText("Select K10188-13").click();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Copies of K10188-13"), { target: { value: "3" } });
    });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-product-code='K10188-13']").length).toBe(3);
    });
  });
});
