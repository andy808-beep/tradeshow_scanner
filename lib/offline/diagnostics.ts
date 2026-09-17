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
