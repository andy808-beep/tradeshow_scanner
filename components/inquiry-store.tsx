"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_CURRENCY } from "@/lib/format";
import { canSubmitInquiry, summarizeInquiry, type InquirySummary } from "@/lib/inquiry";
import type { CustomerDetails, InquiryLine, Product } from "@/lib/types";
import {
  clearInquiryDraft,
  draftToCreateRequest,
  newClientSubmissionId,
  readInquiryDraft,
  writeInquiryDraft,
  type InquiryConfirmationSnapshot,
  type InquiryDraftRecord,
} from "@/lib/offline/inquiry-draft";
import { enqueueOutboxSnapshot, readOutboxRecord } from "@/lib/offline/inquiry-outbox";
import { isOnline } from "@/lib/offline/lookup";
import { syncInquiryOutbox } from "@/lib/offline/inquiry-sync";

const EMPTY_CUSTOMER: CustomerDetails = {
  name: "",
  company: "",
  notes: "",
};

export type AddProductResult = { ok: true } | { ok: false; reason: string };

export type SavedInquiryConfirmation = InquiryConfirmationSnapshot;

interface InquiryContextValue {
  ready: boolean;
  lines: InquiryLine[];
  customer: CustomerDetails;
  summary: InquirySummary;
  currency: string;
  confirmation: SavedInquiryConfirmation | null;
  findLine: (productId: string) => InquiryLine | undefined;
  addProduct: (product: Product) => AddProductResult;
  removeLine: (productId: string) => void;
  setQuotedUnitPrice: (productId: string, price: number | null) => void;
  setLineNotes: (productId: string, notes: string) => void;
  updateCustomer: (patch: Partial<CustomerDetails>) => void;
  saveInquiry: () => Promise<{ ok: true } | { ok: false; message: string; details: string[] }>;
  refreshConfirmation: () => Promise<void>;
  clearInquiry: () => void;
}

const InquiryContext = createContext<InquiryContextValue | null>(null);

function emptyRecord(now = Date.now()): InquiryDraftRecord {
  return {
    customer: EMPTY_CUSTOMER,
    currency: DEFAULT_CURRENCY,
    lines: [],
    confirmation: null,
    createdAt: now,
    updatedAt: now,
  };
}

function hasSessionContent(record: Pick<InquiryDraftRecord, "lines" | "customer" | "confirmation">) {
  return (
    record.confirmation !== null ||
    record.lines.length > 0 ||
    record.customer.name.trim() !== "" ||
    record.customer.company.trim() !== "" ||
    record.customer.notes.trim() !== ""
  );
}

export function InquiryProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [record, setRecord] = useState<InquiryDraftRecord>(() => emptyRecord());
  const createdAtRef = useRef(record.createdAt);
  const touchedRef = useRef(false);
  const persistIdRef = useRef(0);
  const savingRef = useRef(false);

  const lines = record.lines;
  const customer = record.customer;
  const confirmation = record.confirmation;
  const currency = lines[0]?.product.currency ?? record.currency ?? DEFAULT_CURRENCY;
  const locked = confirmation !== null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readInquiryDraft().catch(() => null);
      if (cancelled) return;
      if (stored && !touchedRef.current) {
        createdAtRef.current = stored.createdAt;
        setRecord(stored);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const next: InquiryDraftRecord = {
      customer,
      currency,
      lines,
      confirmation,
      createdAt: createdAtRef.current,
      updatedAt: Date.now(),
    };
    const persistId = persistIdRef.current;
    void (async () => {
      if (cancelled) return;
      try {
        if (!hasSessionContent(next)) {
          await clearInquiryDraft();
          return;
        }
        if (cancelled || persistIdRef.current !== persistId) return;
        await writeInquiryDraft(next);
        if (persistIdRef.current !== persistId) {
          await clearInquiryDraft();
        }
      } catch {
        // IndexedDB can be mocked or closing during logout; never throw into React.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, customer, currency, lines, confirmation]);

  const patchRecord = useCallback((updater: (current: InquiryDraftRecord) => InquiryDraftRecord) => {
    touchedRef.current = true;
    setRecord((current) => updater(current));
  }, []);

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

      patchRecord((current) => {
        if (current.confirmation || current.lines.some((line) => line.product.id === product.id)) {
          return current;
        }
        return {
          ...current,
          lines: [
            ...current.lines,
            {
              product,
              quotedUnitPrice: product.unitPrice,
              notes: "",
            },
          ],
        };
      });

      return { ok: true };
    },
    [lines, locked, patchRecord],
  );

  const removeLine = useCallback((productId: string) => {
    if (locked) return;
    patchRecord((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.product.id !== productId),
    }));
  }, [locked, patchRecord]);

  const setQuotedUnitPrice = useCallback((productId: string, price: number | null) => {
    if (locked) return;
    patchRecord((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.product.id === productId ? { ...line, quotedUnitPrice: price } : line,
      ),
    }));
  }, [locked, patchRecord]);

  const setLineNotes = useCallback((productId: string, notes: string) => {
    if (locked) return;
    patchRecord((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.product.id === productId ? { ...line, notes } : line,
      ),
    }));
  }, [locked, patchRecord]);

  const updateCustomer = useCallback((patch: Partial<CustomerDetails>) => {
    if (locked) return;
    patchRecord((current) => ({
      ...current,
      customer: { ...current.customer, ...patch },
    }));
  }, [locked, patchRecord]);

  const saveInquiry = useCallback(async (): Promise<
    { ok: true } | { ok: false; message: string; details: string[] }
  > => {
    if (locked || savingRef.current) {
      return { ok: false, message: "This inquiry has already been saved.", details: [] };
    }
    if (!canSubmitInquiry(lines, customer)) {
      const details = lines
        .filter((line) => line.quotedUnitPrice === null || typeof line.quotedUnitPrice !== "number")
        .map((line) => `${line.product.code} has no quoted price.`);
      return {
        ok: false,
        message: "Customer name, at least one product and a quoted price on every line are required.",
        details,
      };
    }

    savingRef.current = true;
    const clientSubmissionId = newClientSubmissionId();
    const payload = draftToCreateRequest(
      { customer, currency, lines },
      clientSubmissionId,
    );
    const snapshot: InquiryConfirmationSnapshot = {
      source: "queued",
      clientSubmissionId,
      inquiryId: null,
      customerName: customer.name.trim(),
      companyName: customer.company.trim(),
      productCount: lines.length,
    };

    try {
      await enqueueOutboxSnapshot(payload, {
        customerName: snapshot.customerName,
        companyName: snapshot.companyName,
        productCount: snapshot.productCount,
        currency,
      });

      const now = Date.now();
      createdAtRef.current = now;
      patchRecord(() => ({
        customer: EMPTY_CUSTOMER,
        currency: DEFAULT_CURRENCY,
        lines: [],
        confirmation: snapshot,
        createdAt: now,
        updatedAt: now,
      }));

      if (isOnline()) {
        const result = await syncInquiryOutbox(true);
        if (result.synchronized > 0) {
          const row = await readOutboxRecord(clientSubmissionId);
          if (row?.status === "synchronized" && row.serverInquiryId) {
            patchRecord((current) => ({
              ...current,
              confirmation: current.confirmation
                ? {
                    ...current.confirmation,
                    source: "synced",
                    inquiryId: row.serverInquiryId,
                  }
                : current.confirmation,
            }));
          }
        }
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The inquiry could not be saved on this device.",
        details: [],
      };
    } finally {
      savingRef.current = false;
    }

    return { ok: true };
  }, [locked, lines, customer, currency, patchRecord]);

  const refreshConfirmation = useCallback(async () => {
    if (!confirmation?.clientSubmissionId) return;
    if (confirmation.source === "synced" && confirmation.inquiryId) return;
    const clientSubmissionId = confirmation.clientSubmissionId;
    try {
      const row = await readOutboxRecord(clientSubmissionId);
      if (row?.status !== "synchronized" || !row.serverInquiryId) return;
      const serverInquiryId = row.serverInquiryId;
      patchRecord((existing) => ({
        ...existing,
        confirmation:
          existing.confirmation &&
          existing.confirmation.clientSubmissionId === clientSubmissionId
            ? {
                ...existing.confirmation,
                source: "synced",
                inquiryId: serverInquiryId,
              }
            : existing.confirmation,
      }));
    } catch {
      // Confirmation is a convenience link; the outbox remains the source of truth.
    }
  }, [confirmation, patchRecord]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void refreshConfirmation();
    }, 0);
    function onOnline() {
      void refreshConfirmation();
    }
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [ready, refreshConfirmation]);

  const clearInquiry = useCallback(() => {
    persistIdRef.current += 1;
    const now = Date.now();
    createdAtRef.current = now;
    touchedRef.current = true;
    setRecord(emptyRecord(now));
    void clearInquiryDraft();
  }, []);

  const value = useMemo<InquiryContextValue>(
    () => ({
      ready,
      lines,
      customer,
      currency,
      summary: summarizeInquiry(lines),
      confirmation,
      findLine: (productId) => lines.find((line) => line.product.id === productId),
      addProduct,
      removeLine,
      setQuotedUnitPrice,
      setLineNotes,
      updateCustomer,
      saveInquiry,
      refreshConfirmation,
      clearInquiry,
    }),
    [
      ready,
      lines,
      customer,
      currency,
      confirmation,
      addProduct,
      removeLine,
      setQuotedUnitPrice,
      setLineNotes,
      updateCustomer,
      saveInquiry,
      refreshConfirmation,
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
