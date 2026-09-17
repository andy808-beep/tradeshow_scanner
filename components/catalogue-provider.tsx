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
import { readCatalogueMeta, readCatalogueProducts } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/lookup";
import { syncProductCatalogue } from "@/lib/offline/sync";

interface CatalogueContextValue {
  products: Product[];
  meta: CatalogueMeta | null;
  access: CatalogueAccess;
  online: boolean;
  syncing: boolean;
  syncError: string | null;
  sync: () => Promise<void>;
  resetLocal: () => void;
}

const CatalogueContext = createContext<CatalogueContextValue | null>(null);

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<CatalogueMeta | null>(null);
  const [online, setOnline] = useState(isOnline);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void readCatalogueMeta().then(async (nextMeta) => {
      const nextProducts = nextMeta ? await readCatalogueProducts() : [];
      if (cancelled) return;
      setMeta(nextMeta);
      setProducts(nextProducts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, []);

  const resetLocal = useCallback(() => {
    setProducts([]);
    setMeta(null);
    setSyncError(null);
  }, []);

  const access = useMemo(() => inspectCatalogueAccess(meta, now), [meta, now]);

  const value = useMemo<CatalogueContextValue>(
    () => ({
      products,
      meta,
      access,
      online,
      syncing,
      syncError,
      sync,
      resetLocal,
    }),
    [products, meta, access, online, syncing, syncError, sync, resetLocal],
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
