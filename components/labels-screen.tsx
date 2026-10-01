"use client";

import { useEffect, useMemo, useState } from "react";
import { listLabelProductsRequest } from "@/lib/api-client";
import { zh } from "@/lib/i18n/zh-cn";
import { describeCode39Error, isCode39Compatible } from "@/lib/code39";
import {
  DEFAULT_LABEL_LAYOUT,
  expandLabelCopies,
  type LabelSelectionItem,
} from "@/lib/label-layout";
import {
  A4_40_LABELS_52x29,
  clampPdfSettings,
  DEFAULT_LABEL_PDF_SETTINGS,
  LABEL_PDF_BOUNDS,
  LABEL_PDF_FONT_PUBLIC_PATH,
  LABEL_PDF_PRINT_INSTRUCTIONS,
  toLabelPdfProduct,
  type LabelPdfSettings,
} from "@/lib/label-pdf-template";
import {
  isSelected,
  selectAllResults,
  setCopies,
  toggleSelection,
} from "@/lib/label-selection";
import { productTitle, type Product } from "@/lib/types";
import LabelSheet from "./label-sheet";
import OnlineOnlyNotice from "./online-only-notice";

const fieldClasses =
  "h-10 w-full rounded-lg border border-porcelain-300 bg-white px-2.5 text-sm text-porcelain-950 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none";

function filterCatalogue(products: Product[], query: string): Product[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return products;
  return products.filter(
    (product) =>
      product.code.toLowerCase().includes(trimmed) ||
      (product.nameEn?.toLowerCase().includes(trimmed) ?? false) ||
      (product.nameZh?.toLowerCase().includes(trimmed) ?? false),
  );
}

export default function LabelsScreen() {
  const [catalogue, setCatalogue] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LabelSelectionItem<Product>[]>([]);
  const [pdfSettings, setPdfSettings] = useState<LabelPdfSettings>(DEFAULT_LABEL_PDF_SETTINGS);
  const [pdfBusy, setPdfBusy] = useState<"production" | "calibration" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listLabelProductsRequest("", controller.signal)
      .then((products) => {
        setCatalogue(products);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          zh.errors.productDataUnavailable,
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const results = useMemo(() => filterCatalogue(catalogue, query), [catalogue, query]);
  const printable = useMemo(() => expandLabelCopies(selected), [selected]);
  const invalidSelected = selected.filter((item) => !isCode39Compatible(item.product.code));
  const allResultsSelected =
    results.length > 0 && results.every((product) => isSelected(selected, product.id));

  function patchPdf(patch: Partial<LabelPdfSettings>) {
    setPdfSettings((current) => clampPdfSettings({ ...current, ...patch }));
  }

  const pdfProducts = useMemo(
    () =>
      printable
        .filter((product) => isCode39Compatible(product.code))
        .map(toLabelPdfProduct),
    [printable],
  );

  async function exportPdf(mode: "production" | "calibration") {
    setPdfError(null);
    setPdfBusy(mode);
    try {
      const fontResponse = await fetch(LABEL_PDF_FONT_PUBLIC_PATH);
      if (!fontResponse.ok) {
        throw new Error(zh.labels.pdfFailed);
      }
      const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
      const { generateCalibrationLabelPdf, generateProductionLabelPdf } =
        await import("@/lib/label-pdf");
      const result =
        mode === "calibration"
          ? await generateCalibrationLabelPdf({ settings: pdfSettings, fontBytes })
          : await generateProductionLabelPdf({
              products: pdfProducts,
              settings: pdfSettings,
              fontBytes,
            });
      if (result.plan.skippedCodes.length > 0) {
        setPdfError(result.plan.skippedCodes.map((item) => item.message).join(" "));
      }
      const hasPrintedLabels = result.plan.slots.some((slot) => slot.productCode);
      if (mode === "production" && !hasPrintedLabels) {
        return;
      }
      downloadPdfBytes(
        result.bytes,
        mode === "calibration" ? zh.labels.calibrationFile : zh.labels.productionFile,
      );
    } catch {
      setPdfError(zh.labels.pdfFailed);
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="print-controls space-y-4">
        <OnlineOnlyNotice>
          {zh.labels.onlineRequired}
        </OnlineOnlyNotice>
        <div>
          <h1 className="text-xl font-semibold text-porcelain-950">{zh.labels.heading}</h1>
          <p className="mt-1 text-sm text-porcelain-600">{zh.labels.description}</p>
        </div>

        <label htmlFor="label-search" className="sr-only">
          {zh.labels.searchLabel}
        </label>
        <input
          id="label-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={zh.labels.searchPlaceholder}
          autoComplete="off"
          className="w-full rounded-xl border border-porcelain-300 bg-white px-3.5 py-3 text-base text-porcelain-950 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelected(selectAllResults(selected, results))}
            disabled={results.length === 0 || allResultsSelected}
            className="flex-1 rounded-xl border border-porcelain-300 px-3 py-2.5 text-sm font-semibold text-porcelain-700 disabled:text-porcelain-300"
          >
            {zh.labels.selectAll}
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            disabled={selected.length === 0}
            className="rounded-xl border border-porcelain-300 px-3 py-2.5 text-sm font-semibold text-porcelain-700 disabled:text-porcelain-300"
          >
            {zh.labels.clearSelection}
          </button>
        </div>

        <div aria-live="polite">
          {loading && <p className="text-sm text-porcelain-500">{zh.labels.loading}</p>}
          {loadError && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">{zh.sync.catalogueUnavailable}</p>
              <p className="mt-1">{loadError}</p>
            </div>
          )}
          {!loading && !loadError && results.length === 0 && (
            <p className="text-sm text-porcelain-500">{zh.labels.noMatches}</p>
          )}
        </div>

        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((product) => {
            const checked = isSelected(selected, product.id);
            const compatible = isCode39Compatible(product.code);
            return (
              <li key={product.id}>
                <label className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-porcelain-50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected(toggleSelection(selected, product))}
                    className="mt-1 h-4 w-4"
                    aria-label={zh.product.selectAria(product.code)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-xs font-semibold text-porcelain-600">
                      {product.code}
                    </span>
                    <span className="block truncate text-sm text-porcelain-950">
                      {productTitle(product)}
                    </span>
                    {!compatible && (
                      <span className="block text-xs text-red-700">
                        {describeCode39Error(product.code)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {selected.length > 0 && (
          <section className="space-y-2 rounded-xl border border-porcelain-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2
                id="copies-heading"
                className="text-sm font-semibold tracking-wide text-porcelain-600 uppercase"
              >
                {zh.labels.copiesPerProduct}
              </h2>
              <p className="shrink-0 text-xs text-porcelain-500">
                {selected.length} 款产品
              </p>
            </div>
            <ul
              aria-labelledby="copies-heading"
              data-copies-scroll=""
              className="copies-scroll max-h-[17rem] space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-porcelain-200 bg-porcelain-50 p-2"
            >
              {selected.map((item) => (
                <li
                  key={item.product.id}
                  className="flex min-w-0 items-center gap-2 py-1"
                >
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate font-mono text-xs font-semibold text-porcelain-700">
                      {item.product.code}
                    </span>
                    <span className="block truncate text-xs text-porcelain-600">
                      {productTitle(item.product)}
                    </span>
                  </span>
                  <label className="flex shrink-0 items-center gap-2 text-sm text-porcelain-600">
                    {zh.labels.copies}
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={item.copies}
                      onChange={(event) =>
                        setSelected(
                          setCopies(selected, item.product.id, Number(event.target.value)),
                        )
                      }
                      aria-label={zh.product.copiesAria(item.product.code)}
                      className="h-10 w-16 rounded-lg border border-porcelain-300 bg-white px-2 text-right text-sm font-semibold"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {invalidSelected.length > 0 && (
          <p className="text-sm font-medium text-red-700">
            {zh.labels.incompatible(invalidSelected.length)}
          </p>
        )}

        <section className="space-y-3 rounded-xl border border-porcelain-200 bg-white p-3">
          <h2 className="text-sm font-semibold tracking-wide text-porcelain-600 uppercase">
            {zh.labels.exportPdf}
          </h2>
          <p className="text-xs text-porcelain-500">{zh.labels.pdfIntro}</p>
          <p className="text-sm font-medium text-porcelain-900">{A4_40_LABELS_52x29.name}</p>
          <p className="text-xs text-porcelain-500">{zh.labels.startHint}</p>
          <div className="grid grid-cols-2 gap-3">
            <LayoutField
              id="pdf-start-at"
              label={zh.labels.startAt}
              value={pdfSettings.startAt}
              bounds={LABEL_PDF_BOUNDS.startAt}
              onChange={(startAt) => patchPdf({ startAt })}
            />
            <LayoutField
              id="pdf-offset-x"
              label={zh.labels.offsetXMm}
              value={pdfSettings.offsetXMm}
              bounds={LABEL_PDF_BOUNDS.offsetXMm}
              onChange={(offsetXMm) => patchPdf({ offsetXMm })}
            />
            <LayoutField
              id="pdf-offset-y"
              label={zh.labels.offsetYMm}
              value={pdfSettings.offsetYMm}
              bounds={LABEL_PDF_BOUNDS.offsetYMm}
              onChange={(offsetYMm) => patchPdf({ offsetYMm })}
            />
            <LayoutField
              id="pdf-padding"
              label={zh.labels.paddingMm}
              value={pdfSettings.paddingMm}
              bounds={LABEL_PDF_BOUNDS.paddingMm}
              onChange={(paddingMm) => patchPdf({ paddingMm })}
            />
            <LayoutField
              id="pdf-barcode-height"
              label={zh.labels.barcodeHeightMm}
              value={pdfSettings.barcodeHeightMm}
              bounds={LABEL_PDF_BOUNDS.barcodeHeightMm}
              onChange={(barcodeHeightMm) => patchPdf({ barcodeHeightMm })}
            />
            <LayoutField
              id="pdf-module"
              label={zh.labels.barcodeWidthMm}
              value={pdfSettings.moduleMm}
              bounds={LABEL_PDF_BOUNDS.moduleMm}
              onChange={(moduleMm) => patchPdf({ moduleMm })}
            />
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <h3 className="text-xs font-semibold tracking-wide text-amber-900 uppercase">
              {zh.labels.printInstructions}
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-amber-950">
              {LABEL_PDF_PRINT_INSTRUCTIONS.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ol>
          </div>
          {pdfError && <p className="text-sm font-medium text-red-700">{pdfError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void exportPdf("production");
              }}
              disabled={pdfProducts.length === 0 || pdfBusy !== null}
              className="flex-1 rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-porcelain-300"
            >
              {pdfBusy === "production" ? zh.labels.generatingPdf : zh.labels.exportPdf}
            </button>
            <button
              type="button"
              onClick={() => {
                void exportPdf("calibration");
              }}
              disabled={pdfBusy !== null}
              className="flex-1 rounded-xl border border-porcelain-300 px-4 py-3 text-sm font-semibold text-porcelain-700 disabled:text-porcelain-300"
            >
              {pdfBusy === "calibration" ? zh.labels.generatingPdf : zh.labels.calibrationPdf}
            </button>
          </div>
        </section>
      </div>

      <LabelSheet products={printable} layout={DEFAULT_LABEL_LAYOUT} />
    </div>
  );
}

function LayoutField({
  id,
  label,
  value,
  bounds,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  bounds: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-porcelain-600">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={fieldClasses}
      />
    </div>
  );
}

function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
