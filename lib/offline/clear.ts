import { clearAllLocalData, deleteCatalogueDatabase } from "./db";
import { offlineDebug } from "./diagnostics";

/**
 * Erases confidential local data on logout.
 *
 * The stores are emptied first: that always succeeds, while deleting the
 * database can be blocked by another open tab. The database is then removed
 * as well, with a bounded wait. The service-worker shell cache is left alone
 * because it must not contain catalogue rows.
 */
export async function clearConfidentialLocalData(): Promise<void> {
  try {
    await clearAllLocalData();
  } catch {
    // Fall through: deleting the database is the stronger step.
  }
  const deleted = await deleteCatalogueDatabase();
  offlineDebug("logout.cleared", { databaseDeleted: deleted });
}
