export interface LabelLayout {
  /** Physical label width in millimetres. */
  widthMm: number;
  /** Physical label height in millimetres. */
  heightMm: number;
  /** Inset on every side, millimetres. */
  marginMm: number;
  /** Height of the barcode bars, millimetres. */
  barcodeHeightMm: number;
  /** Width of a narrow bar, millimetres. */
  moduleMm: number;
}

export const DEFAULT_LABEL_LAYOUT: LabelLayout = {
  widthMm: 70,
  heightMm: 40,
  marginMm: 3,
  barcodeHeightMm: 14,
  moduleMm: 0.25,
};

export const LABEL_LAYOUT_BOUNDS = {
  widthMm: { min: 30, max: 150, step: 1 },
  heightMm: { min: 20, max: 90, step: 1 },
  marginMm: { min: 0, max: 12, step: 0.5 },
  barcodeHeightMm: { min: 8, max: 40, step: 0.5 },
  moduleMm: { min: 0.15, max: 0.6, step: 0.05 },
} as const;

export const MIN_COPIES = 1;
export const MAX_COPIES = 99;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return MIN_COPIES;
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.floor(value)));
}

export function clampLayout(layout: LabelLayout): LabelLayout {
  const bounds = LABEL_LAYOUT_BOUNDS;
  const widthMm = clamp(layout.widthMm, bounds.widthMm.min, bounds.widthMm.max);
  const heightMm = clamp(layout.heightMm, bounds.heightMm.min, bounds.heightMm.max);
  const marginMm = clamp(layout.marginMm, bounds.marginMm.min, bounds.marginMm.max);
  const barcodeHeightMm = clamp(
    layout.barcodeHeightMm,
    bounds.barcodeHeightMm.min,
    Math.min(bounds.barcodeHeightMm.max, heightMm - 2 * marginMm),
  );
  const moduleMm = clamp(layout.moduleMm, bounds.moduleMm.min, bounds.moduleMm.max);
  return { widthMm, heightMm, marginMm, barcodeHeightMm, moduleMm };
}

export interface LabelSelectionItem<T> {
  product: T;
  copies: number;
}

/** Repeats each selected product according to its copy count, in selection order. */
export function expandLabelCopies<T>(items: LabelSelectionItem<T>[]): T[] {
  const expanded: T[] = [];
  for (const item of items) {
    const copies = clampCopies(item.copies);
    for (let i = 0; i < copies; i += 1) expanded.push(item.product);
  }
  return expanded;
}
