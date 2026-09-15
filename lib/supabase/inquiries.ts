import "server-only";

import type { CreateInquiryRequest } from "@/lib/api-contract";
import { getAdminSupabase } from "./admin";
import { DatabaseError, InquiryValidationError } from "./errors";
import { getActiveProductsByIds } from "./products";

/**
 * Persists an inquiry through the `create_trade_show_inquiry` function, which
 * writes the `inquiries` row and its `inquiry_items` in one transaction and
 * snapshots each product's code and name itself.
 *
 * The RPC expects camelCase keys inside `p_items`.
 */
export async function createInquiry(input: CreateInquiryRequest): Promise<string> {
  const productIds = input.items.map((item) => item.productId);
  const products = await getActiveProductsByIds(productIds);

  const missing = productIds.filter((id) => !products.has(id));
  if (missing.length > 0) {
    throw new InquiryValidationError(
      "One or more products are unavailable.",
      missing.map((id) => `Product ${id} does not exist or is not active.`),
    );
  }

  const currencies = new Set([...products.values()].map((product) => product.currency));
  if (currencies.size > 1) {
    throw new InquiryValidationError("An inquiry cannot mix currencies.", [
      `Products in this inquiry use: ${[...currencies].sort().join(", ")}.`,
    ]);
  }

  const [productCurrency] = currencies;
  if (productCurrency !== input.currency) {
    throw new InquiryValidationError("Currency does not match the products.", [
      `Inquiry is ${input.currency} but the products are priced in ${productCurrency}.`,
    ]);
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase.rpc("create_trade_show_inquiry", {
    p_customer_name: input.customerName,
    p_company_name: input.companyName || null,
    p_staff_name: input.staffName || null,
    p_notes: input.notes || null,
    p_currency: input.currency,
    p_items: input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      quotedPrice: item.quotedPrice,
    })),
  });

  if (error) {
    // The function raises its own validation errors with SQLSTATE P0001.
    if (error.code === "P0001") {
      throw new InquiryValidationError(error.message);
    }
    throw new DatabaseError(error.message);
  }

  if (typeof data !== "string") {
    throw new DatabaseError("The database did not return an inquiry id.");
  }

  return data;
}
