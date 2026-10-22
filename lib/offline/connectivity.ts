import { ApiError } from "@/lib/api-client";
import { zh } from "@/lib/i18n/zh-cn";
import { offlineDebug } from "./diagnostics";

/** Same-origin reachability probe. Never a direct Supabase URL. */
export const HEALTH_PATH = "/api/health";

export const SERVER_REACHABLE_EVENT = "koei-server-reachable";

const HEALTH_TIMEOUT_MS = 4_000;
const SYNC_TIMEOUT_MS = 15_000;

let healthTimeoutMs = HEALTH_TIMEOUT_MS;
let syncTimeoutMs = SYNC_TIMEOUT_MS;

const timers = new Set<ReturnType<typeof setTimeout>>();

export type ProbeResult =
  | { kind: "reachable"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

export interface ConnectivityTrace {
  event: string;
  navigatorOnline: boolean;
  displayMode: string;
  sw: string;
  status: number;
  category: string;
  source: string;
}

let latestTrace: ConnectivityTrace | null = null;
const traces: ConnectivityTrace[] = [];

export function latestConnectivityTrace(): ConnectivityTrace | null {
  return latestTrace;
}

export function connectivityTraces(): readonly ConnectivityTrace[] {
  return traces;
}

export function setHealthTimeoutForTests(ms: number): void {
  healthTimeoutMs = ms;
}

export function setCatalogueSyncTimeoutForTests(ms: number): void {
  syncTimeoutMs = ms;
}

export function catalogueSyncTimeoutMs(): number {
  return syncTimeoutMs;
}

export function resetConnectivityForTests(): void {
  healthTimeoutMs = HEALTH_TIMEOUT_MS;
  syncTimeoutMs = SYNC_TIMEOUT_MS;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  latestTrace = null;
  traces.length = 0;
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "RequestTimeoutError";
  }
}

function browserDisplayMode(): string {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "unknown";
  }
  if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
  return "browser";
}

function serviceWorkerState(): string {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const controller = navigator.serviceWorker.controller;
  if (!controller) return "none";
  return controller.state || "controlled";
}

function trace(
  event: string,
  extra: { status?: number; category?: string; source?: string } = {},
): void {
  const entry: ConnectivityTrace = {
    event,
    navigatorOnline: typeof navigator !== "undefined" && navigator.onLine,
    displayMode: browserDisplayMode(),
    sw: serviceWorkerState(),
    status: extra.status ?? 0,
    category: extra.category ?? "",
    source: extra.source ?? "",
  };
  latestTrace = entry;
  traces.push(entry);
  if (traces.length > 40) traces.shift();
  offlineDebug(event, {
    navigatorOnline: entry.navigatorOnline,
    displayMode: entry.displayMode,
    sw: entry.sw,
    status: entry.status,
    category: entry.category,
    source: entry.source,
  });
}

/**
 * A received HTTP response proves the server was reached, including 401 and
 * other non-2xx statuses. Only a missing response is a network failure.
 */
export function noteServerResponse(status: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SERVER_REACHABLE_EVENT, { detail: status }));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (settled) return;
      settled = true;
      reject(new RequestTimeoutError());
    }, ms);
    timers.add(timer);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        timers.delete(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        timers.delete(timer);
        reject(error);
      },
    );
  });
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  try {
    return await withTimeout(
      fetcher(input, { ...init, signal: controller.signal }),
      timeoutMs,
    );
  } catch (error) {
    controller.abort();
    if (error instanceof RequestTimeoutError) throw error;
    if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new RequestTimeoutError();
    }
    throw error;
  }
}

export async function probeServer(
  reason: string,
  fetcher: typeof fetch = fetch,
): Promise<ProbeResult> {
  trace("health.start", { source: reason });
  try {
    const response = await fetchWithTimeout(
      HEALTH_PATH,
      { method: "GET", cache: "no-store", credentials: "same-origin" },
      healthTimeoutMs,
      fetcher,
    );
    trace("health.end", {
      source: reason,
      status: response.status,
      category: response.status === 401 ? "session" : "http",
    });
    noteServerResponse(response.status);
    return { kind: "reachable", status: response.status };
  } catch (error) {
    const category = error instanceof RequestTimeoutError ? "timeout" : "network";
    trace("health.end", { category, source: reason });
    return { kind: category };
  }
}

export function classifySyncFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return zh.sync.loginExpired;
    if (error.status === 408 || error.status === 504) return zh.sync.requestTimeout;
    if (error.status >= 500) return zh.sync.serverUnavailable;
    return zh.sync.catalogueInvalid;
  }
  if (error instanceof RequestTimeoutError) return zh.sync.requestTimeout;
  if (
    error instanceof Error &&
    (error.name === "CataloguePayloadError" || error.name === "CatalogueVerificationError")
  ) {
    return zh.sync.catalogueInvalid;
  }
  return zh.sync.serverUnreachable;
}

export function logCatalogueSync(
  phase: "start" | "end",
  extra: { source?: string; category?: string; count?: number } = {},
): void {
  trace(phase === "start" ? "sync.start" : "sync.end", {
    source: extra.source ?? "",
    category: extra.category ?? "",
  });
  if (extra.count !== undefined) {
    offlineDebug(phase === "start" ? "sync.start" : "sync.end", { count: extra.count });
  }
}
