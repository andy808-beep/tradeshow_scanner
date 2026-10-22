"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { zh } from "@/lib/i18n/zh-cn";
import type { Product } from "@/lib/types";
import {
  inspectCatalogueAccess,
  type CatalogueAccess,
  type CatalogueMeta,
} from "@/lib/offline/authorization";
import {
  classifySyncFailure,
  probeServer,
  SERVER_REACHABLE_EVENT,
  type ProbeResult,
} from "@/lib/offline/connectivity";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import {
  readCatalogueSnapshot,
  readOfflineReadiness,
  writeOfflineReadiness,
} from "@/lib/offline/db";
import { offlineDebug } from "@/lib/offline/diagnostics";
import { isOnline } from "@/lib/offline/lookup";
import {
  NO_READINESS,
  offlineStage,
  type OfflineReadiness,
  type OfflineStage,
} from "@/lib/offline/readiness";
import { preloadScannerAssets } from "@/lib/offline/scanner-assets";
import {
  requestBackgroundCatalogueSync,
  syncProductCatalogue,
  type CatalogueSyncResult,
} from "@/lib/offline/sync";

interface CatalogueContextValue {
  products: Product[];
  meta: CatalogueMeta | null;
  access: CatalogueAccess;
  readiness: OfflineReadiness;
  /** How far offline setup has progressed: catalogue, assets, camera. */
  stage: OfflineStage;
  online: boolean;
  syncing: boolean;
  syncError: string | null;
  /** Set when the local catalogue itself could not be read. */
  localError: string | null;
  sync: () => Promise<void>;
  /** Same-origin reachability probe. Does not read `navigator.onLine` alone. */
  recheckNetwork: () => void;
  /** Records that the real camera opened here, completing offline setup. */
  confirmCameraReady: () => void;
  resetLocal: () => void;
}

const CatalogueContext = createContext<CatalogueContextValue | null>(null);

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<CatalogueMeta | null>(null);
  const [readiness, setReadiness] = useState<OfflineReadiness>(NO_READINESS);
  // `navigatorOnline` is only a hint. `serverReachable` is set from a real
  // HTTP response or a failed probe, never from the hint alone.
  const [navigatorOnline, setNavigatorOnline] = useState(isOnline);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const online =
    serverReachable === true || (serverReachable === null && navigatorOnline);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  /** Read-modify-write against IndexedDB so concurrent updates cannot clash. */
  const patchReadiness = useCallback(async (patch: Partial<OfflineReadiness>) => {
    const current = await readOfflineReadiness();
    const next = { ...current, ...patch };
    await writeOfflineReadiness(next);
    setReadiness(next);
  }, []);

  const preloadScanner = useCallback(async () => {
    const loaded = await preloadScannerAssets();
    if (!loaded) return false;
    await patchReadiness({ scannerAssetsReadyAt: Date.now() });
    return true;
  }, [patchReadiness]);

  const confirmCameraReady = useCallback(() => {
    void patchReadiness({ cameraVerifiedAt: Date.now() });
  }, [patchReadiness]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshot, nextReadiness] = await Promise.all([
          readCatalogueSnapshot(),
          readOfflineReadiness(),
        ]);
        if (cancelled) return;

        offlineDebug("load.snapshot", {
          storedProducts: snapshot.count,
          metaCount: snapshot.meta?.count ?? -1,
          allCodesSearchable: snapshot.allCodesSearchable,
        });

        // A meta record that claims rows the products store does not hold is
        // treated as no catalogue, so the UI asks for a sync instead of
        // searching an empty store.
        const usable =
          snapshot.meta !== null && snapshot.count === snapshot.meta.count
            ? snapshot.meta
            : null;

        setMeta(usable);
        setProducts(usable ? snapshot.products : []);
        setReadiness(nextReadiness);
        setLocalError(null);
        setHydrated(true);

        // Catch up devices that synced before the scanner was preloadable.
        if (usable && nextReadiness.scannerAssetsReadyAt === null && isOnline()) {
          void preloadScanner();
        }
      } catch (error) {
        // A rejected IndexedDB read is surfaced, never swallowed.
        offlineDebug("load.failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
        if (!cancelled) {
          setLocalError(LOOKUP_MESSAGES.localUnavailable);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preloadScanner]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const applyProbeResult = useCallback((result: ProbeResult, reason: string) => {
    const hintOnline = isOnline();
    setNavigatorOnline(hintOnline);
    if (result.kind === "reachable") {
      setServerReachable(true);
      if (result.status === 401) {
        setSyncError(zh.sync.loginExpired);
      } else if (result.status >= 500) {
        setSyncError(zh.sync.serverUnavailable);
      } else if (reason === "recheck") {
        setSyncError(null);
      } else {
        setSyncError((current) =>
          current === zh.sync.serverUnreachable ||
          current === zh.sync.requestTimeout ||
          current === zh.sync.serverUnavailable ||
          current === zh.sync.loginExpired
            ? null
            : current,
        );
      }
      return;
    }

    if (reason === "recheck" || !hintOnline) setServerReachable(false);
    if (reason === "recheck") {
      setSyncError(
        result.kind === "timeout" ? zh.sync.requestTimeout : zh.sync.serverUnreachable,
      );
    }
  }, []);

  const scheduleProbeRef = useRef<(reason: string) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let queued: string | null = null;

    async function run(reason: string) {
      const result = await probeServer(reason);
      if (cancelled) return;
      applyProbeResult(result, reason);
    }

    function schedule(reason: string) {
      if (cancelled) return;
      if (running) {
        queued = reason;
        return;
      }
      running = true;
      void run(reason).finally(() => {
        running = false;
        if (cancelled) return;
        const next = queued;
        queued = null;
        if (next) schedule(next);
      });
    }

    scheduleProbeRef.current = schedule;

    function onOnline() {
      setNavigatorOnline(true);
      schedule("online");
    }
    function onOffline() {
      setNavigatorOnline(false);
      schedule("offline");
    }
    function onPageShow(event: Event) {
      const record = event as Event & { persisted?: boolean };
      schedule(record.persisted ? "pageshow-persisted" : "pageshow");
    }
    function onFocus() {
      schedule("focus");
    }
    function onVisibility() {
      if (document.visibilityState === "visible") schedule("visibility");
    }
    function onResume() {
      schedule("resume");
    }
    function onReachable(event: Event) {
      const status =
        event instanceof CustomEvent && typeof event.detail === "number" ? event.detail : 0;
      if (status === 0) return;
      setServerReachable(true);
      if (status === 401) setSyncError(zh.sync.loginExpired);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("resume", onResume);
    window.addEventListener("resume", onResume);
    window.addEventListener(SERVER_REACHABLE_EVENT, onReachable);
    schedule("mount");

    return () => {
      cancelled = true;
      scheduleProbeRef.current = () => {};
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("resume", onResume);
      window.removeEventListener("resume", onResume);
      window.removeEventListener(SERVER_REACHABLE_EVENT, onReachable);
    };
  }, [applyProbeResult]);

  const applySyncFailure = useCallback(async (error: unknown, source: "manual" | "background") => {
    const kept = await readCatalogueSnapshot().catch(() => null);
    const usable =
      kept !== null && kept.meta !== null && kept.count === kept.meta.count ? kept.meta : null;

    if (usable && kept) {
      setMeta(usable);
      setProducts(kept.products);
    }

    const message = classifySyncFailure(error);
    setSyncError(message);
    const lostNetwork =
      message === zh.sync.serverUnreachable || message === zh.sync.requestTimeout;
    if (lostNetwork) {
      if (source === "manual" || !isOnline()) setServerReachable(false);
    } else {
      setServerReachable(true);
    }
  }, []);

  const applySyncResult = useCallback(
    async (job: Promise<CatalogueSyncResult>, source: "manual" | "background") => {
      setSyncing(true);
      setSyncError(null);
      try {
        const result = await job;
        setProducts(result.products);
        setMeta(result.meta);
        setLocalError(null);
        setServerReachable(true);
        setNow(Date.now());
        // Scanner and decoder chunks are code-split, so they must be fetched
        // while the connection is still up or the camera cannot start offline.
        await preloadScanner();
      } catch (error) {
        await applySyncFailure(error, source);
      } finally {
        setSyncing(false);
      }
    },
    [applySyncFailure, preloadScanner],
  );

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    await applySyncResult(syncProductCatalogue(), "manual");
  }, [applySyncResult]);

  const recheckNetwork = useCallback(() => {
    scheduleProbeRef.current("recheck");
  }, []);

  useEffect(() => {
    if (!hydrated || !online) return;
    const pending = requestBackgroundCatalogueSync();
    if (!pending) return;
    void (async () => {
      await Promise.resolve();
      await applySyncResult(pending, "background");
    })();
  }, [applySyncResult, hydrated, online]);

  const resetLocal = useCallback(() => {
    setProducts([]);
    setMeta(null);
    setReadiness(NO_READINESS);
    setSyncError(null);
    setLocalError(null);
  }, []);

  const access = useMemo(() => inspectCatalogueAccess(meta, now), [meta, now]);
  const stage = useMemo(() => offlineStage(access, readiness), [access, readiness]);

  const value = useMemo<CatalogueContextValue>(
    () => ({
      products,
      meta,
      access,
      readiness,
      stage,
      online,
      syncing,
      syncError,
      localError,
      sync,
      recheckNetwork,
      confirmCameraReady,
      resetLocal,
    }),
    [
      products,
      meta,
      access,
      readiness,
      stage,
      online,
      syncing,
      syncError,
      localError,
      sync,
      recheckNetwork,
      confirmCameraReady,
      resetLocal,
    ],
  );

  return <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>;
}

export function useCatalogue(): CatalogueContextValue {
  const value = useContext(CatalogueContext);
  if (!value) {
    throw new Error("useCatalogue must be used inside <CatalogueProvider>");
  }
  return value;
}

export function useCatalogueOptional(): CatalogueContextValue | null {
  return useContext(CatalogueContext);
}
