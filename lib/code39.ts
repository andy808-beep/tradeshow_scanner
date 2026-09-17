/**
 * Code 39 encoder for Koei product labels.
 *
 * Koei's labels encode `products.product_code` directly — no separate barcode
 * number, no check digit. The patterns match ZXing's Code39Reader so a printed
 * label of K10188-13 decodes back to exactly "K10188-13", hyphen included.
 *
 * The JS ZXing port ships a reader but not a writer (Code39Writer is commented
 * out of MultiFormatWriter), which is why encoding lives here.
 */

/** Standard Code 39 alphabet. Lowercase is not in the set. */
export const CODE39_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";

/**
 * 9-bit wide/narrow patterns, 1 = wide, 0 = narrow, MSB first. Identical to
 * ZXing `Code39Reader.CHARACTER_ENCODINGS` so encode and decode agree.
 */
const CHARACTER_ENCODINGS = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, // 0-9
  0x109, 0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c, // A-J
  0x103, 0x043, 0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016, // K-T
  0x181, 0x0c1, 0x1c0, 0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4, 0x0a8, // U-$
  0x0a2, 0x08a, 0x02a, // /-%
];

const ASTERISK_ENCODING = 0x094;
const WIDE_RATIO = 3;
export const QUIET_ZONE_MODULES = 10;

export class Code39Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Code39Error";
  }
}

export function isCode39Compatible(value: string): boolean {
  if (value === "") return false;
  for (const character of value) {
    if (!CODE39_ALPHABET.includes(character)) return false;
  }
  return true;
}

export function code39IncompatibleCharacters(value: string): string[] {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const character of value) {
    if (!CODE39_ALPHABET.includes(character) && !seen.has(character)) {
      seen.add(character);
      invalid.push(character);
    }
  }
  return invalid;
}

export function describeCode39Error(value: string): string {
  if (value === "") return "Product code is empty.";
  const invalid = code39IncompatibleCharacters(value);
  if (invalid.length === 0) return "";
  const shown = invalid
    .map((character) => (character === " " ? "space" : character))
    .join(", ");
  return `Cannot encode “${value}” as Code 39. Unsupported: ${shown}.`;
}

export interface BarRun {
  /** True for a black bar, false for a gap. */
  black: boolean;
  /** Width in narrow-module units. Wide bars are {@link WIDE_RATIO}. */
  modules: number;
}

function patternRuns(encoding: number): BarRun[] {
  const runs: BarRun[] = [];
  for (let bit = 8; bit >= 0; bit -= 1) {
    const wide = ((encoding >> bit) & 1) === 1;
    runs.push({
      black: (8 - bit) % 2 === 0,
      modules: wide ? WIDE_RATIO : 1,
    });
  }
  return runs;
}

function characterEncoding(character: string): number {
  if (character === "*") return ASTERISK_ENCODING;
  const index = CODE39_ALPHABET.indexOf(character);
  if (index === -1) {
    throw new Code39Error(describeCode39Error(character));
  }
  return CHARACTER_ENCODINGS[index];
}

/**
 * Encodes `value` as Code 39 runs, wrapped in start/stop asterisks and quiet
 * zones. The payload is `value` unchanged — no case folding, no hyphen
 * stripping, no check digit.
 */
export function encodeCode39(value: string): BarRun[] {
  if (!isCode39Compatible(value)) {
    throw new Code39Error(describeCode39Error(value));
  }

  const runs: BarRun[] = [{ black: false, modules: QUIET_ZONE_MODULES }];
  const characters = ["*", ...value, "*"];

  characters.forEach((character, index) => {
    if (index > 0) runs.push({ black: false, modules: 1 });
    runs.push(...patternRuns(characterEncoding(character)));
  });

  runs.push({ black: false, modules: QUIET_ZONE_MODULES });
  return runs;
}

export function totalModules(runs: BarRun[]): number {
  return runs.reduce((sum, run) => sum + run.modules, 0);
}

/** Flattened scanline: `true` is black. Used to round-trip through ZXing. */
export function encodeCode39Bits(value: string, modulePixels = 3): boolean[] {
  const bits: boolean[] = [];
  for (const run of encodeCode39(value)) {
    for (let i = 0; i < run.modules * modulePixels; i += 1) {
      bits.push(run.black);
    }
  }
  return bits;
}

/**
 * The string that must come back from a scanner. Identical to the product
 * code: start/stop asterisks are framing, not data.
 */
export function encodedCode39Value(value: string): string {
  if (!isCode39Compatible(value)) {
    throw new Code39Error(describeCode39Error(value));
  }
  return value;
}
