/**
 * Development-only offline tracing.
 *
 * Only counts, stage names and booleans are ever passed in: no prices, no
 * product rows, no tokens. Silent in production builds.
 */
export type DiagnosticDetails = Record<string, number | string | boolean>;

export function offlineDebug(stage: string, details: DiagnosticDetails): void {
  // Development only: silent in production builds and under test.
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[offline] ${stage}`, details);
}

export type ScanLookupSource = "local" | "online" | "none";

export type ScanDiagnosticResult =
  | "product"
  | "multiple"
  | "not-found"
  | "timeout"
  | "failed";

/** Development timing for one scan. The decoded value is a product code, never a price. */
export interface ScanDiagnostic {
  decodeMs: number;
  decodedValue: string;
  format: string | null;
  lookupSource: ScanLookupSource;
  lookupMs: number;
  result: ScanDiagnosticResult;
}

let latestScan: ScanDiagnostic | null = null;

export function latestScanDiagnostic(): ScanDiagnostic | null {
  return latestScan;
}

export function resetScanDiagnosticsForTests(): void {
  latestScan = null;
}

/**
 * Remembers the latest scan and prints it in development only.
 * Employee-facing screens never show these fields.
 */
export function recordScanDiagnostic(diagnostic: ScanDiagnostic): void {
  latestScan = diagnostic;
  if (process.env.NODE_ENV !== "development") return;
  console.info("[scan]", {
    decodeMs: diagnostic.decodeMs,
    decodedValue: diagnostic.decodedValue,
    format: diagnostic.format ?? "",
    lookupSource: diagnostic.lookupSource,
    lookupMs: diagnostic.lookupMs,
    result: diagnostic.result,
  });
}
