import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Product } from "@/lib/types";
import {
  CATALOGUE_DB_NAME,
  CATALOGUE_DB_VERSION,
  CATALOGUE_META_KEY,
  CODE_KEY_INDEX,
  DRAFT_STORE,
  INQUIRY_SYNC_META_KEY,
  META_STORE,
  OUTBOX_STORE,
  PRODUCTS_STORE,
  READINESS_META_KEY,
} from "./constants";
import type { CatalogueMeta } from "./authorization";
import type { InquiryDraftRecord } from "./inquiry-records";
import type { InquiryOutboxRecord, InquirySyncMeta } from "./inquiry-records";
import { NO_READINESS, type OfflineReadiness } from "./readiness";
import { normalizeLookupValue } from "./search";

/**
 * Products are keyed by `id` (the catalogue UUID) and carry a derived
 * `codeKey`: the product code with separators and case removed. The same
 * normalization runs on every query, so a stored record is always reachable
 * by the code an employee types or scans.
 */
export type StoredProduct = Product & { codeKey: string };

interface CatalogueDB extends DBSchema {
  [PRODUCTS_STORE]: {
    key: string;
    value: StoredProduct;
    indexes: { [CODE_KEY_INDEX]: string };
  };
  [META_STORE]: {
    key: string;
    value: CatalogueMeta | OfflineReadiness | InquirySyncMeta;
  };
  [DRAFT_STORE]: {
    key: string;
    value: InquiryDraftRecord;
  };
  [OUTBOX_STORE]: {
    key: string;
    value: InquiryOutboxRecord;
  };
}

function isCatalogueMeta(value: unknown): value is CatalogueMeta {
  return typeof value === "object" && value !== null && "lastSyncedAt" in value && "count" in value;
}

function isReadiness(value: unknown): value is OfflineReadiness {
  return (
    typeof value === "object" && value !== null && "scannerAssetsReadyAt" in value
  );
}

export function isInquirySyncMeta(value: unknown): value is InquirySyncMeta {
  return typeof value === "object" && value !== null && "lastInquirySyncedAt" in value;
}

export function toStoredProduct(product: Product): StoredProduct {
  return { ...product, codeKey: normalizeLookupValue(product.code) };
}

/** Strips the derived key so callers only ever see an exact `Product`. */
function toProduct(stored: StoredProduct): Product {
  const { codeKey, ...product } = stored;
  void codeKey;
  return product;
}

let dbPromise: Promise<IDBPDatabase<CatalogueDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<CatalogueDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatalogueDB>(CATALOGUE_DB_NAME, CATALOGUE_DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 2) {
          // The catalogue is a cache: rebuilding both stores is always safe and
          // avoids a half-migrated state where meta claims rows the products
          // store does not hold. Sync metadata goes too, so the UI asks for a
          // fresh sync instead of reporting a count it cannot serve.
          if (database.objectStoreNames.contains(PRODUCTS_STORE)) {
            database.deleteObjectStore(PRODUCTS_STORE);
          }
          if (database.objectStoreNames.contains(META_STORE)) {
            database.deleteObjectStore(META_STORE);
          }
          const products = database.createObjectStore(PRODUCTS_STORE, { keyPath: "id" });
          products.createIndex(CODE_KEY_INDEX, "codeKey");
          database.createObjectStore(META_STORE);
        }

        if (oldVersion < 3) {
          if (!database.objectStoreNames.contains(DRAFT_STORE)) {
            database.createObjectStore(DRAFT_STORE);
          }
          if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
            database.createObjectStore(OUTBOX_STORE, { keyPath: "clientSubmissionId" });
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function readCatalogueMeta(): Promise<CatalogueMeta | null> {
  const db = await getDb();
  const value = await db.get(META_STORE, CATALOGUE_META_KEY);
  return isCatalogueMeta(value) ? value : null;
}

export async function readCatalogueProducts(): Promise<Product[]> {
  const db = await getDb();
  return (await db.getAll(PRODUCTS_STORE)).map(toProduct);
}

export async function countCatalogueProducts(): Promise<number> {
  const db = await getDb();
  return db.count(PRODUCTS_STORE);
}

/** Exact lookup through the normalized-code index, for verification. */
export async function findStoredProductByCode(code: string): Promise<Product | null> {
  const db = await getDb();
  const stored = await db.getFromIndex(
    PRODUCTS_STORE,
    CODE_KEY_INDEX,
    normalizeLookupValue(code),
  );
  return stored ? toProduct(stored) : null;
}

export async function readOfflineReadiness(): Promise<OfflineReadiness> {
  const db = await getDb();
  const value = await db.get(META_STORE, READINESS_META_KEY);
  return isReadiness(value) ? value : NO_READINESS;
}

export async function writeOfflineReadiness(
  readiness: OfflineReadiness,
): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, readiness, READINESS_META_KEY);
}

export async function readInquirySyncMeta(): Promise<InquirySyncMeta | null> {
  const db = await getDb();
  const value = await db.get(META_STORE, INQUIRY_SYNC_META_KEY);
  return isInquirySyncMeta(value) ? value : null;
}

export async function writeInquirySyncMeta(meta: InquirySyncMeta): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, meta, INQUIRY_SYNC_META_KEY);
}

/**
 * Replaces the local catalogue in one IndexedDB transaction and resolves only
 * after it commits. If any write fails, IndexedDB aborts the whole
 * transaction and the previous complete catalogue remains.
 */
export async function replaceCatalogue(
  products: Product[],
  meta: CatalogueMeta,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PRODUCTS_STORE, META_STORE], "readwrite");
  const store = tx.objectStore(PRODUCTS_STORE);

  // Requests are queued without awaiting each one: an interleaved non-IndexedDB
  // await would let the transaction auto-commit early.
  const writes: Promise<unknown>[] = [store.clear()];
  for (const product of products) {
    writes.push(store.put(toStoredProduct(product)));
  }
  writes.push(tx.objectStore(META_STORE).put(meta, CATALOGUE_META_KEY));

  await Promise.all(writes);
  await tx.done;
}

export interface CatalogueSnapshot {
  meta: CatalogueMeta | null;
  products: Product[];
  count: number;
  /** False when any stored record lacks a usable normalized code. */
  allCodesSearchable: boolean;
}

/** Reads the committed catalogue back in a fresh transaction. */
export async function readCatalogueSnapshot(): Promise<CatalogueSnapshot> {
  const db = await getDb();
  const tx = db.transaction([PRODUCTS_STORE, META_STORE], "readonly");
  const [stored, rawMeta] = await Promise.all([
    tx.objectStore(PRODUCTS_STORE).getAll(),
    tx.objectStore(META_STORE).get(CATALOGUE_META_KEY),
  ]);
  await tx.done;

  return {
    meta: isCatalogueMeta(rawMeta) ? rawMeta : null,
    products: stored.map(toProduct),
    count: stored.length,
    allCodesSearchable: stored.every((record) => record.codeKey.length > 0),
  };
}

function storeNames(): Array<typeof PRODUCTS_STORE | typeof META_STORE | typeof DRAFT_STORE | typeof OUTBOX_STORE> {
  return [PRODUCTS_STORE, META_STORE, DRAFT_STORE, OUTBOX_STORE];
}

/**
 * Empties every store, including the readiness record, the editable draft and
 * the inquiry outbox. Unlike deleting the database this cannot be blocked by
 * another open tab, so it is what actually guarantees the confidential rows
 * are gone at logout.
 */
export async function clearAllLocalData(): Promise<void> {
  const db = await getDb();
  const names = storeNames().filter((name) => db.objectStoreNames.contains(name));
  const tx = db.transaction(names, "readwrite");
  await Promise.all(names.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

/**
 * Deletes the whole database. Another tab holding a connection blocks this
 * indefinitely, so the wait is bounded and the result reported; the stores
 * have already been emptied by then.
 */
export async function deleteCatalogueDatabase(timeoutMs = 2_000): Promise<boolean> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([
      deleteDB(CATALOGUE_DB_NAME)
        .then(() => true)
        .catch(() => false),
      expiry,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function resetCatalogueDbForTests(): void {
  dbPromise = null;
}
