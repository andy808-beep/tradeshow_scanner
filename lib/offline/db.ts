import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Product } from "@/lib/types";
import {
  CATALOGUE_DB_NAME,
  CATALOGUE_DB_VERSION,
  CATALOGUE_META_KEY,
  META_STORE,
  PRODUCTS_STORE,
} from "./constants";
import type { CatalogueMeta } from "./authorization";

interface CatalogueDB extends DBSchema {
  [PRODUCTS_STORE]: {
    key: string;
    value: Product;
  };
  [META_STORE]: {
    key: string;
    value: CatalogueMeta;
  };
}

let dbPromise: Promise<IDBPDatabase<CatalogueDB>> | null = null;

function getDb(): Promise<IDBPDatabase<CatalogueDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatalogueDB>(CATALOGUE_DB_NAME, CATALOGUE_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(PRODUCTS_STORE)) {
          database.createObjectStore(PRODUCTS_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function readCatalogueMeta(): Promise<CatalogueMeta | null> {
  const db = await getDb();
  return (await db.get(META_STORE, CATALOGUE_META_KEY)) ?? null;
}

export async function readCatalogueProducts(): Promise<Product[]> {
  const db = await getDb();
  return db.getAll(PRODUCTS_STORE);
}

/**
 * Replaces the local catalogue in one IndexedDB transaction. If the write
 * fails, IndexedDB aborts and the previous complete catalogue remains.
 */
export async function replaceCatalogue(
  products: Product[],
  meta: CatalogueMeta,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PRODUCTS_STORE, META_STORE], "readwrite");
  await tx.objectStore(PRODUCTS_STORE).clear();
  for (const product of products) {
    await tx.objectStore(PRODUCTS_STORE).put(product);
  }
  await tx.objectStore(META_STORE).put(meta, CATALOGUE_META_KEY);
  await tx.done;
}

export async function clearCatalogue(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PRODUCTS_STORE, META_STORE], "readwrite");
  await tx.objectStore(PRODUCTS_STORE).clear();
  await tx.objectStore(META_STORE).clear();
  await tx.done;
}

/** Deletes the whole confidential database. Used on logout. */
export async function deleteCatalogueDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }
  await deleteDB(CATALOGUE_DB_NAME);
}

export function resetCatalogueDbForTests(): void {
  dbPromise = null;
}
