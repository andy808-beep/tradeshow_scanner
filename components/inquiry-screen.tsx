"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, createInquiryRequest } from "@/lib/api-client";
import { isLinePriced } from "@/lib/inquiry";
import CustomerForm from "./customer-form";
import InquiryLineCard from "./inquiry-line-card";
import { useInquiry } from "./inquiry-store";
import InquirySummary from "./inquiry-summary";
import OnlineOnlyNotice from "./online-only-notice";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string; details: string[] }
  | { status: "saved"; inquiryId: string };

export default function InquiryScreen() {
  const { lines, customer, currency, clearInquiry } = useInquiry();
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const saved = save.status === "saved";
  const saving = save.status === "saving";
  const unpricedLines = lines.filter((line) => !isLinePriced(line));
  const canSave =
    lines.length > 0 &&
    customer.name.trim() !== "" &&
    unpricedLines.length === 0 &&
    !saving &&
    !saved;

  async function handleSave() {
    // The button is disabled in this state; this also rejects a save triggered
    // any other way. The API validates independently regardless.
    if (unpricedLines.length > 0) {
      setSave({
        status: "error",
        message: "Every product needs a quoted price before saving.",
        details: unpricedLines.map(
          (line) => `${line.product.code} has no quoted price.`,
        ),
      });
      return;
    }

    setSave({ status: "saving" });
    try {
      const inquiryId = await createInquiryRequest({
        customerName: customer.name,
        companyName: customer.company,
        notes: customer.notes,
        currency,
        items: lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          quotedPrice: line.quotedUnitPrice as number,
        })),
      });
      setSave({ status: "saved", inquiryId });
    } catch (error) {
      // The inquiry is deliberately left intact so nothing typed at the booth
      // is lost when saving fails.
      setSave({
        status: "error",
        message: error instanceof Error ? error.message : "The inquiry could not be saved.",
        details: error instanceof ApiError ? error.details : [],
      });
    }
  }

  function startNewInquiry() {
    clearInquiry();
    setSave({ status: "idle" });
  }

  if (lines.length === 0 && !saved) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-lg font-semibold text-porcelain-950">No products yet</h1>
        <p className="text-sm text-porcelain-600">
          Search for a product and add it to start an inquiry.
        </p>
        <Link
          href="/"
          className="inline-block rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white"
        >
          Go to search
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-porcelain-950">Inquiry</h1>
      <OnlineOnlyNotice>
        Saving an inquiry needs a network connection in this version. Queued
        offline submission is not available yet.
      </OnlineOnlyNotice>

      {saved && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Inquiry saved</p>
          <p className="mt-1 text-xs text-emerald-800">Inquiry ID</p>
          <p className="font-mono text-sm break-all text-emerald-950">{save.inquiryId}</p>
          <button
            type="button"
            onClick={startNewInquiry}
            className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            Start new inquiry
          </button>
        </section>
      )}

      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line.product.id}>
            <InquiryLineCard line={line} />
          </li>
        ))}
      </ul>

      <CustomerForm disabled={saving || saved} />
      <InquirySummary />

      {save.status === "error" && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">{save.message}</p>
          {save.details.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {save.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-red-800">Nothing was lost — try saving again.</p>
        </div>
      )}

      {!saved && (
        <>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm disabled:bg-porcelain-300"
          >
            {saving ? "Saving…" : "Save inquiry"}
          </button>

          {customer.name.trim() === "" && (
            <p className="text-center text-xs text-porcelain-500">
              Enter a customer name to save this inquiry.
            </p>
          )}

          {unpricedLines.length > 0 && (
            <p className="text-center text-xs font-medium text-red-700">
              {unpricedLines.length === 1
                ? `${unpricedLines[0].product.code} needs a quoted price before saving.`
                : `${unpricedLines.length} products need a quoted price before saving.`}
            </p>
          )}

          <button
            type="button"
            onClick={clearInquiry}
            disabled={saving}
            className="w-full rounded-xl border border-porcelain-300 px-4 py-3 text-sm font-semibold text-porcelain-600"
          >
            Clear inquiry
          </button>
        </>
      )}
    </div>
  );
}
