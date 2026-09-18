"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "@/lib/api-client";
import type { Product } from "@/lib/types";
import {
  inspectCatalogueAccess,
  type CatalogueAccess,
  type CatalogueMeta,
} from "@/lib/offline/authorization";
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
  CatalogueVerificationError,
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
  /** Records that the real camera opened here, completing offline setup. */
  confirmCameraReady: () => void;
  resetLocal: () => void;
}

const CatalogueContext = createContext<CatalogueContextValue | null>(null);

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<CatalogueMeta | null>(null);
  const [readiness, setReadiness] = useState<OfflineReadiness>(NO_READINESS);
  const [online, setOnline] = useState(isOnline);
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
    function handleOnline() {
      setOnline(isOnline());
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
      window.clearInterval(timer);
    };
  }, []);

  const applySyncFailure = useCallback(async (error: unknown) => {
    const kept = await readCatalogueSnapshot().catch(() => null);
    const usable =
      kept !== null && kept.meta !== null && kept.count === kept.meta.count ? kept.meta : null;
    const keptReady = inspectCatalogueAccess(usable, Date.now()).kind === "ready";

    if (usable && kept) {
      setMeta(usable);
      setProducts(kept.products);
    }

    setSyncError(
      error instanceof ApiError && error.status === 401
        ? "Sign-in expired. Sign in again, then sync."
        : error instanceof CatalogueVerificationError
          ? `${error.message} ${
              keptReady ? LOOKUP_MESSAGES.syncFailed : LOOKUP_MESSAGES.syncFailedRetry
            }`
          : keptReady
            ? LOOKUP_MESSAGES.syncFailed
            : LOOKUP_MESSAGES.syncFailedRetry,
    );
  }, []);

  const applySyncResult = useCallback(
    async (job: Promise<CatalogueSyncResult>) => {
      setSyncing(true);
      setSyncError(null);
      try {
        const result = await job;
        setProducts(result.products);
        setMeta(result.meta);
        setLocalError(null);
        setNow(Date.now());
        // Scanner and decoder chunks are code-split, so they must be fetched
        // while the connection is still up or the camera cannot start offline.
        await preloadScanner();
      } catch (error) {
        await applySyncFailure(error);
      } finally {
        setSyncing(false);
      }
    },
    [applySyncFailure, preloadScanner],
  );

  const sync = useCallback(async () => {
    await applySyncResult(syncProductCatalogue());
  }, [applySyncResult]);

  useEffect(() => {
    if (!hydrated || !online) return;
    const pending = requestBackgroundCatalogueSync();
    if (!pending) return;
    void (async () => {
      await Promise.resolve();
      await applySyncResult(pending);
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
