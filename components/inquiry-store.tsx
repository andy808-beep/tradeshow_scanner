"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_CURRENCY } from "@/lib/format";
import { summarizeInquiry, type InquirySummary } from "@/lib/inquiry";
import type { CustomerDetails, InquiryLine, Product } from "@/lib/types";

const EMPTY_CUSTOMER: CustomerDetails = {
  name: "",
  company: "",
  notes: "",
};

export type AddProductResult = { ok: true } | { ok: false; reason: string };

export interface SavedInquiryConfirmation {
  inquiryId: string;
  customerName: string;
  companyName: string;
  productCount: number;
}

interface InquiryContextValue {
  lines: InquiryLine[];
  customer: CustomerDetails;
  summary: InquirySummary;
  /** One currency per inquiry, taken from the first product added. */
  currency: string;
  /** Set only after POST /api/inquiries succeeds. The draft is then locked. */
  confirmation: SavedInquiryConfirmation | null;
  findLine: (productId: string) => InquiryLine | undefined;
  addProduct: (product: Product) => AddProductResult;
  removeLine: (productId: string) => void;
  setQuotedUnitPrice: (productId: string, price: number | null) => void;
  updateCustomer: (patch: Partial<CustomerDetails>) => void;
  markSubmitted: (inquiryId: string) => void;
  clearInquiry: () => void;
}

const InquiryContext = createContext<InquiryContextValue | null>(null);

export function InquiryProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<InquiryLine[]>([]);
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER);
  const [confirmation, setConfirmation] = useState<SavedInquiryConfirmation | null>(
    null,
  );

  const currency = lines[0]?.product.currency ?? DEFAULT_CURRENCY;
  const locked = confirmation !== null;

  const addProduct = useCallback(
    (product: Product): AddProductResult => {
      if (locked) {
        return {
          ok: false,
          reason: "This inquiry has already been saved. Start the next inquiry to add products.",
        };
      }

      const existingCurrency = lines[0]?.product.currency;
      if (existingCurrency && existingCurrency !== product.currency) {
        return {
          ok: false,
          reason: `This inquiry is priced in ${existingCurrency}. Start a new inquiry before adding a ${product.currency} product.`,
        };
      }

      if (lines.some((line) => line.product.id === product.id)) {
        return { ok: true };
      }

      setLines((current) => {
        if (current.some((line) => line.product.id === product.id)) {
          return current;
        }
        return [
          ...current,
          {
            product,
            // Seeded from the listed price, copied as-is to keep every
            // decimal the database holds. Null stays null so the employee
            // has to quote it.
            quotedUnitPrice: product.unitPrice,
          },
        ];
      });

      return { ok: true };
    },
    [lines, locked],
  );

  const removeLine = useCallback((productId: string) => {
    if (locked) return;
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, [locked]);

  const setQuotedUnitPrice = useCallback((productId: string, price: number | null) => {
    if (locked) return;
    setLines((current) =>
      current.map((line) =>
        line.product.id === productId ? { ...line, quotedUnitPrice: price } : line,
      ),
    );
  }, [locked]);

  const updateCustomer = useCallback((patch: Partial<CustomerDetails>) => {
    if (locked) return;
    setCustomer((current) => ({ ...current, ...patch }));
  }, [locked]);

  const markSubmitted = useCallback((inquiryId: string) => {
    setConfirmation({
      inquiryId,
      customerName: customer.name.trim(),
      companyName: customer.company.trim(),
      productCount: lines.length,
    });
  }, [customer, lines.length]);

  const clearInquiry = useCallback(() => {
    setLines([]);
    setCustomer(EMPTY_CUSTOMER);
    setConfirmation(null);
  }, []);

  const value = useMemo<InquiryContextValue>(
    () => ({
      lines,
      customer,
      currency,
      summary: summarizeInquiry(lines),
      confirmation,
      findLine: (productId) => lines.find((line) => line.product.id === productId),
      addProduct,
      removeLine,
      setQuotedUnitPrice,
      updateCustomer,
      markSubmitted,
      clearInquiry,
    }),
    [
      lines,
      customer,
      currency,
      confirmation,
      addProduct,
      removeLine,
      setQuotedUnitPrice,
      updateCustomer,
      markSubmitted,
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
