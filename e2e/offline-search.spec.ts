import { expect, test, type Page, type Request } from "@playwright/test";
import {
  CATALOGUE_SIZE,
  FEATURED_CODE,
  TEST_EMAIL,
  TEST_PASSWORD,
} from "./supabase-mock.mjs";

/**
 * The offline acceptance path in a real browser: sync online, go offline, then
 * find, open and quote a product with no network at all.
 */

const CATALOGUE_DB = "koei-tradeshow";

function isProductApiRequest(request: Request): boolean {
  const url = new URL(request.url());
  return (
    url.pathname.startsWith("/api/products") &&
    url.pathname !== "/api/products/catalogue"
  );
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: "Sync products" })).toBeVisible();
}

/** Counts what the browser itself committed to IndexedDB. */
function storedProductCount(page: Page) {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("products", "readonly")
            .objectStore("products")
            .count();
          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => reject(request.error);
        };
      }),
    CATALOGUE_DB,
  );
}

test("finds, opens and quotes a synced product with the network off", async ({
  page,
  context,
}) => {
  const productRequests: string[] = [];
  page.on("request", (request) => {
    if (isProductApiRequest(request)) productRequests.push(request.url());
  });

  // 1 and 2. Authenticated sign-in, then a full catalogue sync.
  await signIn(page);
  await page.getByRole("button", { name: "Sync products" }).click();
  await expect(page.getByText(`${CATALOGUE_SIZE} products`)).toBeVisible({
    timeout: 30_000,
  });

  // 3. The reported count is what IndexedDB actually holds.
  expect(await storedProductCount(page)).toBe(CATALOGUE_SIZE);

  // 4. Cut the network for this browser context.
  await context.setOffline(true);
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  productRequests.length = 0;

  // 5 and 6. A known code resolves from the local catalogue, quickly.
  const started = Date.now();
  await page.getByLabel(/Search by product/).fill(FEATURED_CODE);
  const result = page.getByRole("button", { name: new RegExp(FEATURED_CODE) });
  await expect(result).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - started).toBeLessThan(3_000);
  await expect(page.getByText("Searching…")).toHaveCount(0);

  // 7. Nothing was asked of the product API.
  expect(productRequests).toEqual([]);

  // 8. Opening the result shows the cached details, with no navigation.
  const urlBeforeOpening = page.url();
  await result.click();
  await expect(page.getByRole("heading", { name: "大方盘·紫" })).toBeVisible();
  await expect(page.getByText("Abbesses Plate - L")).toBeVisible();
  await expect(page.getByText(FEATURED_CODE)).toBeVisible();
  await expect(page.getByText("US$2.40")).toBeVisible();
  await expect(page.getByText("24 pcs/ctn")).toBeVisible();
  expect(page.url()).toBe(urlBeforeOpening);

  // The cached product can still be quoted offline.
  await page.getByRole("button", { name: "Add to inquiry" }).click();
  await expect(page.getByText("Added to inquiry")).toBeVisible();

  expect(productRequests).toEqual([]);
});

test("reports an unknown offline code immediately instead of spinning", async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sync products" }).click();
  await expect(page.getByText(`${CATALOGUE_SIZE} products`)).toBeVisible({
    timeout: 30_000,
  });

  await context.setOffline(true);
  await page.getByLabel(/Search by product/).fill("ZZZ-NOT-A-CODE");

  await expect(page.getByText("No match in synchronized catalogue.")).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByText("Searching…")).toHaveCount(0);
});
