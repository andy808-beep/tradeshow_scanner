"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_CURRENCY } from "@/lib/format";
import { calculateTotals, clampQuantity, type InquiryTotals } from "@/lib/inquiry";
import type { CustomerDetails, InquiryLine, Product } from "@/lib/types";

const EMPTY_CUSTOMER: CustomerDetails = {
  name: "",
  company: "",
  staffName: "",
  notes: "",
};

export type AddProductResult = { ok: true } | { ok: false; reason: string };

interface InquiryContextValue {
  lines: InquiryLine[];
  customer: CustomerDetails;
  totals: InquiryTotals;
  /** One currency per inquiry, taken from the first product added. */
  currency: string;
  findLine: (productId: string) => InquiryLine | undefined;
  addProduct: (product: Product) => AddProductResult;
  removeLine: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  setQuotedUnitPrice: (productId: string, price: number | null) => void;
  updateCustomer: (patch: Partial<CustomerDetails>) => void;
  clearInquiry: () => void;
}

const InquiryContext = createContext<InquiryContextValue | null>(null);

export function InquiryProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<InquiryLine[]>([]);
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER);

  const currency = lines[0]?.product.currency ?? DEFAULT_CURRENCY;

  const addProduct = useCallback(
    (product: Product): AddProductResult => {
      const existingCurrency = lines[0]?.product.currency;
      if (existingCurrency && existingCurrency !== product.currency) {
        return {
          ok: false,
          reason: `This inquiry is priced in ${existingCurrency}. Save or clear it before adding a ${product.currency} product.`,
        };
      }

      setLines((current) => {
        const existing = current.find((line) => line.product.id === product.id);
        if (!existing) {
          return [...current, { product, quantity: 1, quotedUnitPrice: null }];
        }
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: clampQuantity(line.quantity + 1) }
            : line,
        );
      });

      return { ok: true };
    },
    [lines],
  );

  const removeLine = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId
          ? { ...line, quantity: clampQuantity(quantity) }
          : line,
      ),
    );
  }, []);

  const setQuotedUnitPrice = useCallback((productId: string, price: number | null) => {
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId ? { ...line, quotedUnitPrice: price } : line,
      ),
    );
  }, []);

  const updateCustomer = useCallback((patch: Partial<CustomerDetails>) => {
    setCustomer((current) => ({ ...current, ...patch }));
  }, []);

  const clearInquiry = useCallback(() => {
    setLines([]);
    setCustomer(EMPTY_CUSTOMER);
  }, []);

  const value = useMemo<InquiryContextValue>(
    () => ({
      lines,
      customer,
      currency,
      totals: calculateTotals(lines),
      findLine: (productId) => lines.find((line) => line.product.id === productId),
      addProduct,
      removeLine,
      setQuantity,
      setQuotedUnitPrice,
      updateCustomer,
      clearInquiry,
    }),
    [
      lines,
      customer,
      currency,
      addProduct,
      removeLine,
      setQuantity,
      setQuotedUnitPrice,
      updateCustomer,
      clearInquiry,
    ],
  );

  return <InquiryContext.Provider value={value}>{children}</InquiryContext.Provider>;
}

export function useInquiry(): InquiryContextValue {
  const value = useContext(InquiryContext);
  if (!value) {
    throw new Error("useInquiry must be used inside <InquiryProvider>");
  }
  return value;
}
