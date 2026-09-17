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
  readCatalogueMeta,
  readCatalogueProducts,
  readOfflineReadiness,
  writeOfflineReadiness,
} from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/lookup";
import {
  NO_READINESS,
  offlineStage,
  type OfflineReadiness,
  type OfflineStage,
} from "@/lib/offline/readiness";
import { preloadScannerAssets } from "@/lib/offline/scanner-assets";
import { syncProductCatalogue } from "@/lib/offline/sync";

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
  const [now, setNow] = useState(() => Date.now());

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
      const [nextMeta, nextReadiness] = await Promise.all([
        readCatalogueMeta(),
        readOfflineReadiness(),
      ]);
      const nextProducts = nextMeta ? await readCatalogueProducts() : [];
      if (cancelled) return;
      setMeta(nextMeta);
      setReadiness(nextReadiness);
      setProducts(nextProducts);

      // Catch up devices that synced before the scanner was preloadable.
      if (nextMeta && nextReadiness.scannerAssetsReadyAt === null && isOnline()) {
        void preloadScanner();
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

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncProductCatalogue();
      setProducts(result.products);
      setMeta(result.meta);
      setNow(Date.now());
      // Scanner and decoder chunks are code-split, so they must be fetched
      // while the connection is still up or the camera cannot start offline.
      await preloadScanner();
    } catch (error) {
      const previous = await readCatalogueMeta();
      setSyncError(
        error instanceof ApiError && error.status === 401
          ? "Sign-in expired. Sign in again, then sync."
          : LOOKUP_MESSAGES.syncFailed,
      );
      if (previous) {
        setMeta(previous);
        setProducts(await readCatalogueProducts());
      }
    } finally {
      setSyncing(false);
    }
  }, [preloadScanner]);

  const resetLocal = useCallback(() => {
    setProducts([]);
    setMeta(null);
    setReadiness(NO_READINESS);
    setSyncError(null);
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
