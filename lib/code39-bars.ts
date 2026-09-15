import { encodeCode39, totalModules } from "./code39";

export interface Code39BarRect {
  /** Left edge, millimetres from the barcode origin. */
  x: number;
  /** Bar width in millimetres. */
  width: number;
}

/**
 * Turns {@link encodeCode39} runs into filled-bar rectangles. SVG and PDF both
 * draw from this so there is only one barcode implementation.
 */
export function code39BarRects(value: string, moduleMm: number): {
  widthMm: number;
  bars: Code39BarRect[];
} {
  const runs = encodeCode39(value);
  const widthMm = totalModules(runs) * moduleMm;
  let x = 0;
  const bars: Code39BarRect[] = [];
  for (const run of runs) {
    if (run.black) bars.push({ x, width: run.modules * moduleMm });
    x += run.modules * moduleMm;
  }
  return { widthMm, bars };
}

/**
 * Preferred module width, reduced if the full Code 39 (quiet zones included)
 * would overflow `maxWidthMm`.
 */
export function fitCode39ModuleMm(
  value: string,
  preferredModuleMm: number,
  maxWidthMm: number,
): number {
  const modules = totalModules(encodeCode39(value));
  if (modules <= 0 || maxWidthMm <= 0) return preferredModuleMm;
  return Math.min(preferredModuleMm, maxWidthMm / modules);
}
