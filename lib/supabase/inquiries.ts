import "server-only";

import type { CreateInquiryRequest } from "@/lib/api-contract";
import { zh } from "@/lib/i18n/zh-cn";
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
    console.error("Inquiry products unavailable:", missing.join(","));
    throw new InquiryValidationError(zh.validation.productsUnavailable);
  }

  const currencies = new Set([...products.values()].map((product) => product.currency));
  if (currencies.size > 1) {
    console.error("Inquiry mixed currencies:", [...currencies].sort().join(","));
    throw new InquiryValidationError(zh.validation.mixedCurrency);
  }

  const [productCurrency] = currencies;
  if (productCurrency !== input.currency) {
    console.error("Inquiry currency mismatch:", input.currency, productCurrency);
    throw new InquiryValidationError(zh.validation.currencyMismatch);
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase.rpc("create_trade_show_inquiry", {
    p_customer_name: input.customerName,
    p_company_name: input.companyName || null,
    // The application no longer collects a staff name, but the stored function
    // still takes this parameter. Passing null keeps the existing signature and
    // the nullable staff_name column working for previously saved inquiries.
    p_staff_name: null,
    p_notes: input.notes || null,
    p_currency: input.currency,
    p_items: input.items.map((item) => ({
      productId: item.productId,
      // Quantity is not collected at the booth. The RPC always stores 1.
      quantity: 1,
      quotedPrice: item.quotedPrice,
      notes: item.notes || "",
    })),
    p_client_submission_id: input.clientSubmissionId,
  });

  if (error) {
    // The function raises its own validation errors with SQLSTATE P0001.
    if (error.code === "P0001") {
      console.error("Inquiry validation:", error.message);
      throw new InquiryValidationError(zh.validation.inquiryInvalid);
    }
    throw new DatabaseError(error.message);
  }

  if (typeof data !== "string") {
    throw new DatabaseError("The database did not return an inquiry id.");
  }

  return data;
}
