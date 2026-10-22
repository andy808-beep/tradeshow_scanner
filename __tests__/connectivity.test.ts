import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { zh } from "@/lib/i18n/zh-cn";
import {
  classifySyncFailure,
  latestConnectivityTrace,
  probeServer,
  RequestTimeoutError,
  resetConnectivityForTests,
  setCatalogueSyncTimeoutForTests,
  setHealthTimeoutForTests,
} from "@/lib/offline/connectivity";
import { CataloguePayloadError, fetchProductCatalogue } from "@/lib/offline/sync";

afterEach(() => {
  resetConnectivityForTests();
  vi.unstubAllGlobals();
});

describe("sync failure classification", () => {
  it("treats 401 as an expired login", () => {
    expect(classifySyncFailure(new ApiError("no", 401))).toBe(zh.sync.loginExpired);
  });

  it("treats request timeout separately from an offline network failure", () => {
    expect(classifySyncFailure(new RequestTimeoutError())).toBe(zh.sync.requestTimeout);
    expect(classifySyncFailure(new ApiError("slow", 504))).toBe(zh.sync.requestTimeout);
    expect(classifySyncFailure(new TypeError("Failed to fetch"))).toBe(zh.sync.serverUnreachable);
  });

  it("treats a server 500 separately from an offline network failure", () => {
    expect(classifySyncFailure(new ApiError("down", 500))).toBe(zh.sync.serverUnavailable);
    expect(classifySyncFailure(new ApiError("down", 503))).toBe(zh.sync.serverUnavailable);
  });

  it("treats an invalid catalogue payload separately", () => {
    expect(classifySyncFailure(new CataloguePayloadError())).toBe(zh.sync.catalogueInvalid);
  });
});

describe("same-origin health probe", () => {
  it("treats a 401 as reachable when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
      return new Response(JSON.stringify({ error: "请先登录。" }), { status: 401 });
    });

    await expect(probeServer("mount", fetcher)).resolves.toEqual({
      kind: "reachable",
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/health", expect.any(Object));
    expect(latestConnectivityTrace()).toMatchObject({
      event: "health.end",
      navigatorOnline: false,
      status: 401,
      category: "session",
      source: "mount",
    });
  });

  it("classifies a timed-out probe separately from a network failure", async () => {
    setHealthTimeoutForTests(20);
    const hanging: typeof fetch = () => new Promise<Response>(() => {});
    const failed: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(probeServer("recheck", hanging)).resolves.toEqual({ kind: "timeout" });
    await expect(probeServer("recheck", failed)).resolves.toEqual({ kind: "network" });
    expect(latestConnectivityTrace()?.category).toBe("network");
  });
});

describe("catalogue request timeout", () => {
  it("rejects a hanging catalogue download as a timeout", async () => {
    setCatalogueSyncTimeoutForTests(20);
    const hangingFetch: typeof fetch = () => new Promise<Response>(() => {});
    await expect(fetchProductCatalogue(hangingFetch)).rejects.toBeInstanceOf(RequestTimeoutError);
  });
});
