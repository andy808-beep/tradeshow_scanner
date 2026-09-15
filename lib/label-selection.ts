import { clampCopies, type LabelSelectionItem } from "./label-layout";

/**
 * Selection helpers for the labels page. Kept pure so tests can cover
 * toggle / select-all / copies without mounting the UI.
 */

export function toggleSelection<T extends { id: string }>(
  selected: LabelSelectionItem<T>[],
  product: T,
): LabelSelectionItem<T>[] {
  const exists = selected.some((item) => item.product.id === product.id);
  if (exists) return selected.filter((item) => item.product.id !== product.id);
  return [...selected, { product, copies: 1 }];
}

export function isSelected<T extends { id: string }>(
  selected: LabelSelectionItem<T>[],
  productId: string,
): boolean {
  return selected.some((item) => item.product.id === productId);
}

/**
 * Adds every product in `results` that is not already selected. Existing copy
 * counts are left alone.
 */
export function selectAllResults<T extends { id: string }>(
  selected: LabelSelectionItem<T>[],
  results: T[],
): LabelSelectionItem<T>[] {
  const next = [...selected];
  const seen = new Set(selected.map((item) => item.product.id));
  for (const product of results) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    next.push({ product, copies: 1 });
  }
  return next;
}

export function setCopies<T extends { id: string }>(
  selected: LabelSelectionItem<T>[],
  productId: string,
  copies: number,
): LabelSelectionItem<T>[] {
  return selected.map((item) =>
    item.product.id === productId ? { ...item, copies: clampCopies(copies) } : item,
  );
}

export function clearSelection<T>(): LabelSelectionItem<T>[] {
  return [];
}
