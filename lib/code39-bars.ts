import { encodeCode39, QUIET_ZONE_MODULES, totalModules } from "./code39";

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

export function code39ModuleCount(value: string): number {
  return totalModules(encodeCode39(value));
}

/**
 * Preferred module width, reduced if the full Code 39 (quiet zones included)
 * would overflow `maxWidthMm`. Used by the on-screen SVG preview.
 */
export function fitCode39ModuleMm(
  value: string,
  preferredModuleMm: number,
  maxWidthMm: number,
): number {
  const modules = code39ModuleCount(value);
  if (modules <= 0 || maxWidthMm <= 0) return preferredModuleMm;
  return Math.min(preferredModuleMm, maxWidthMm / modules);
}

export const MIN_NARROW_BAR_MM = 0.25;

export type Code39LabelFit =
  | {
      ok: true;
      moduleMm: number;
      widthMm: number;
      quietZoneMm: number;
      modules: number;
    }
  | {
      ok: false;
      code: string;
      requiredWidthMm: number;
      availableWidthMm: number;
      minModuleMm: number;
    };

/**
 * Fits a Code 39 into `availableWidthMm` by scaling the module uniformly.
 * Never goes below {@link MIN_NARROW_BAR_MM}. Does not stretch X/Y independently.
 */
export function fitCode39ForLabel(
  value: string,
  availableWidthMm: number,
  preferredModuleMm: number,
  minModuleMm = MIN_NARROW_BAR_MM,
): Code39LabelFit {
  const modules = code39ModuleCount(value);
  const filled = availableWidthMm / modules;
  if (filled + 1e-9 < minModuleMm) {
    return {
      ok: false,
      code: value,
      requiredWidthMm: modules * minModuleMm,
      availableWidthMm,
      minModuleMm,
    };
  }
  let moduleMm = Math.min(preferredModuleMm, filled);
  if (moduleMm + 1e-9 < minModuleMm) {
    moduleMm = filled;
  }
  return {
    ok: true,
    moduleMm,
    widthMm: modules * moduleMm,
    quietZoneMm: QUIET_ZONE_MODULES * moduleMm,
    modules,
  };
}

export function describeUnsafeBarcode(code: string, minModuleMm = MIN_NARROW_BAR_MM): string {
  return `Cannot print “${code}” on this label size without shrinking the narrow bar below ${minModuleMm} mm.`;
}
