"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, createInquiryRequest } from "@/lib/api-client";
import { canSubmitInquiry, isLinePriced, recordedProductsLabel } from "@/lib/inquiry";
import CustomerForm from "./customer-form";
import InquiryLineCard from "./inquiry-line-card";
import { useInquiry } from "./inquiry-store";
import InquirySummary from "./inquiry-summary";
import OnlineOnlyNotice from "./online-only-notice";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string; details: string[] };

export default function InquiryScreen() {
  const router = useRouter();
  const {
    lines,
    customer,
    currency,
    confirmation,
    clearInquiry,
    markSubmitted,
  } = useInquiry();
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const inFlight = useRef(false);

  const saving = save.status === "saving";
  const unpricedLines = lines.filter((line) => !isLinePriced(line));
  const canSave = canSubmitInquiry(lines, customer) && !saving && !confirmation;

  async function handleSave() {
    if (inFlight.current || confirmation || saving) return;

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

    inFlight.current = true;
    setSave({ status: "saving" });
    try {
      const inquiryId = await createInquiryRequest({
        customerName: customer.name,
        companyName: customer.company,
        notes: customer.notes,
        currency,
        items: lines.map((line) => ({
          productId: line.product.id,
          quotedPrice: line.quotedUnitPrice as number,
        })),
      });
      markSubmitted(inquiryId);
      setSave({ status: "idle" });
    } catch (error) {
      inFlight.current = false;
      // The inquiry is deliberately left intact so nothing typed at the booth
      // is lost when saving fails.
      setSave({
        status: "error",
        message: error instanceof Error ? error.message : "The inquiry could not be saved.",
        details: error instanceof ApiError ? error.details : [],
      });
    }
  }

  function startNextInquiry() {
    inFlight.current = false;
    clearInquiry();
    setSave({ status: "idle" });
    router.replace("/");
  }

  if (confirmation) {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-lg font-semibold text-emerald-950">Inquiry saved</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-emerald-800">Customer</dt>
              <dd className="font-medium text-emerald-950">{confirmation.customerName}</dd>
            </div>
            {confirmation.companyName !== "" && (
              <div>
                <dt className="text-xs text-emerald-800">Company</dt>
                <dd className="font-medium text-emerald-950">{confirmation.companyName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-emerald-800">Products</dt>
              <dd className="font-medium text-emerald-950">
                {recordedProductsLabel(confirmation.productCount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-emerald-800">Inquiry ID</dt>
              <dd className="font-mono text-sm break-all text-emerald-950">
                {confirmation.inquiryId}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={startNextInquiry}
            className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            Start next inquiry
          </button>
        </section>
      </div>
    );
  }

  if (lines.length === 0) {
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
          Scan another product
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

      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line.product.id}>
            <InquiryLineCard line={line} />
          </li>
        ))}
      </ul>

      <CustomerForm disabled={saving} />
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

      <Link
        href="/"
        className="block w-full rounded-xl border border-porcelain-300 px-4 py-3 text-center text-sm font-semibold text-porcelain-700"
      >
        Scan another product
      </Link>

      <button
        type="button"
        onClick={() => {
          void handleSave();
        }}
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
    </div>
  );
}
