"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface AppPathValue {
  path: string;
  navigate: (href: string) => void;
}

const AppPathContext = createContext<AppPathValue | null>(null);

const pathListeners = new Set<() => void>();

function subscribeToPath(onStoreChange: () => void) {
  pathListeners.add(onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    pathListeners.delete(onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function getBrowserPath() {
  return window.location.pathname;
}

function notifyPathListeners() {
  pathListeners.forEach((listener) => listener());
}

export function AppPathProvider({ children }: { children: ReactNode }) {
  const nextPath = usePathname();
  const path = useSyncExternalStore(subscribeToPath, getBrowserPath, () => nextPath);

  const navigate = useCallback((href: string) => {
    if (window.location.pathname !== href) {
      window.history.pushState(null, "", href);
    }
    notifyPathListeners();
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <AppPathContext.Provider value={value}>{children}</AppPathContext.Provider>;
}

export function useAppPath(): AppPathValue {
  const value = useContext(AppPathContext);
  if (!value) {
    throw new Error("useAppPath must be used inside <AppPathProvider>");
  }
  return value;
}

export function useAppPathOptional(): AppPathValue | null {
  return useContext(AppPathContext);
}
