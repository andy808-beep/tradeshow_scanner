import { BitArray, Code39Reader } from "@zxing/library";
import { describe, expect, it } from "vitest";
import {
  CODE39_ALPHABET,
  code39IncompatibleCharacters,
  describeCode39Error,
  encodeCode39,
  encodeCode39Bits,
  encodedCode39Value,
  isCode39Compatible,
} from "@/lib/code39";

function decodeBits(bits: boolean[]): string {
  const row = new BitArray(bits.length);
  bits.forEach((black, index) => {
    if (black) row.set(index);
  });
  const result = new Code39Reader(false, false).decodeRow(0, row);
  return result.getText();
}

describe("Code 39 compatibility", () => {
  it("accepts Koei product codes including hyphens", () => {
    for (const code of ["K10188-13", "K9426S-19", "DY-59", "A", "0-9"]) {
      expect(isCode39Compatible(code)).toBe(true);
    }
  });

  it("rejects lowercase, empty, and characters outside the alphabet", () => {
    expect(isCode39Compatible("")).toBe(false);
    expect(isCode39Compatible("k10188-13")).toBe(false);
    expect(isCode39Compatible("K10188_13")).toBe(false);
    expect(isCode39Compatible("大方盘")).toBe(false);
    expect(code39IncompatibleCharacters("k10188_13")).toEqual(["k", "_"]);
  });

  it("covers the full standard alphabet", () => {
    expect(isCode39Compatible(CODE39_ALPHABET)).toBe(true);
  });
});

describe("encoded value is the product code", () => {
  it("encodes K10188-13 unchanged, hyphen included", () => {
    expect(encodedCode39Value("K10188-13")).toBe("K10188-13");
  });

  it("does not convert the code to a number", () => {
    const value = encodedCode39Value("K10188-13");
    expect(typeof value).toBe("string");
    expect(value).toContain("-");
    expect(Number.isNaN(Number(value))).toBe(true);
  });

  it("wraps the payload in start/stop asterisks without putting them in the data", () => {
    const runs = encodeCode39("K10188-13");
    expect(runs[0]).toEqual({ black: false, modules: 10 });
    expect(runs.at(-1)).toEqual({ black: false, modules: 10 });
  });
});

describe("ZXing round-trip", () => {
  it("decodes a generated K10188-13 barcode back to exactly K10188-13", () => {
    const bits = encodeCode39Bits("K10188-13", 3);
    expect(decodeBits(bits)).toBe("K10188-13");
  });

  it("round-trips other typical Koei codes", () => {
    for (const code of ["K9426S-19", "DY-59", "K9000-01"]) {
      expect(decodeBits(encodeCode39Bits(code, 3))).toBe(code);
    }
  });
});

describe("invalid codes", () => {
  it("throws a descriptive error instead of encoding", () => {
    expect(() => encodeCode39("k10188-13")).toThrow(/Code 39/);
    expect(describeCode39Error("k10188-13")).toMatch(/Unsupported/);
    expect(describeCode39Error("")).toMatch(/empty/);
  });
});
