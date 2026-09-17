import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
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

describe("PDF export layout", () => {
  it("does not offer browser print or print preview", async () => {
    render(<LabelsScreen />);
    await waitFor(() => expect(mocks.listLabelProductsRequest).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Print preview" })).toBeNull();
    expect(screen.queryByText("Browser print (secondary)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Exit preview" })).toBeNull();
  });

  it("offers PDF export with the A4 template, calibration and print instructions", async () => {
    render(<LabelsScreen />);
    await waitFor(() => expect(screen.getByLabelText("Select K10188-13")).toBeTruthy());

    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Calibration PDF" })).toBeEnabled();
    expect(screen.getByText("A4 — 40 labels — 52.5 × 29.7 mm")).toBeVisible();
    expect(screen.queryByText("A4 — 21 labels — 70 × 42.3 mm")).toBeNull();
    expect(screen.queryByText("A4 — 10 labels — 105 × 57 mm")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText("Start at label")).toHaveAttribute("max", "40");
    expect(screen.getByLabelText("Start at label")).toHaveAttribute("min", "1");
    expect(screen.getByText(/positions 1–40/i)).toBeVisible();
    expect(screen.getByLabelText("Start at label")).toBeVisible();
    expect(screen.getByLabelText("Horizontal offset (mm)")).toBeVisible();
    expect(screen.getByLabelText("Vertical offset (mm)")).toBeVisible();
    expect(screen.getByText(/Load the A4 sticker sheet/)).toBeVisible();
    expect(screen.getByText(/Print at 100% \/ Actual size/)).toBeVisible();
    expect(screen.getByText(/First print the calibration PDF on ordinary A4 paper/)).toBeVisible();
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

  it("keeps the copies list to about five rows and scrolls extra products", async () => {
    const catalogue = Array.from({ length: 8 }, (_, index) => ({
      ...K10188,
      id: `00000000-0000-4000-8000-00000000000${index}`,
      code: `K1018${index}-13`,
      nameZh: `超长中文名称用于确认截断不会把区块撑宽 ${index}`,
      nameEn: `Very long English name that must truncate without widening the section ${index}`,
    }));
    mocks.listLabelProductsRequest.mockResolvedValue(catalogue);

    const { container } = render(<LabelsScreen />);
    await waitFor(() => expect(screen.getByLabelText("Select K10180-13")).toBeTruthy());

    await act(async () => {
      screen.getByRole("button", { name: "Select all search results" }).click();
    });

    expect(screen.getByRole("heading", { name: "Copies per product" })).toBeVisible();
    expect(screen.getByText("8 products")).toBeVisible();

    const scroller = container.querySelector("[data-copies-scroll]");
    expect(scroller).toBeTruthy();
    expect(scroller).toHaveClass("max-h-[17rem]");
    expect(scroller).toHaveClass("overflow-y-auto");
    expect(scroller).toHaveClass("overflow-x-hidden");
    expect(scroller).toHaveClass("overscroll-contain");
    expect(scroller).toHaveClass("border");

    const heading = screen.getByRole("heading", { name: "Copies per product" });
    expect(scroller?.contains(heading)).toBe(false);
    expect(scroller?.textContent).not.toContain("8 products");

    expect(screen.getByLabelText("Copies of K10180-13")).toBeVisible();
    expect(screen.getByLabelText("Copies of K10187-13")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Copies of K10182-13"), {
        target: { value: "4" },
      });
    });
    expect((screen.getByLabelText("Copies of K10182-13") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("Copies of K10180-13") as HTMLInputElement).value).toBe("1");

    await waitFor(() => {
      expect(container.querySelectorAll("[data-product-code='K10182-13']").length).toBe(4);
      expect(container.querySelectorAll("[data-product-code='K10180-13']").length).toBe(1);
    });
  });
});
