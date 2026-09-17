import { deleteCatalogueDatabase } from "./db";

/**
 * Erases confidential local data. The service-worker shell cache is left
 * alone: it must not contain catalogue rows.
 */
export async function clearConfidentialLocalData(): Promise<void> {
  await deleteCatalogueDatabase();
}
