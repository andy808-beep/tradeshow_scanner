"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { zh } from "@/lib/i18n/zh-cn";
import { canSubmitInquiry, isLinePriced, recordedProductsLabel } from "@/lib/inquiry";
import { useAppPathOptional } from "./app-path";
import CustomerForm from "./customer-form";
import InquiryLineCard from "./inquiry-line-card";
import { useInquiry } from "./inquiry-store";
import InquirySummary from "./inquiry-summary";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string; details: string[] };

export default function InquiryScreen() {
  const router = useRouter();
  const appPath = useAppPathOptional();
  const {
    lines,
    customer,
    confirmation,
    clearInquiry,
    saveInquiry,
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
        message: zh.validation.quotedPrice,
        details: unpricedLines.map((line) => zh.inquiry.lineQuoteMissing(line.product.code)),
      });
      return;
    }

    inFlight.current = true;
    setSave({ status: "saving" });
    const result = await saveInquiry();
    if (!result.ok) {
      inFlight.current = false;
      setSave({
        status: "error",
        message: result.message,
        details: result.details,
      });
      return;
    }
    setSave({ status: "idle" });
  }

  function startNextInquiry() {
    inFlight.current = false;
    clearInquiry();
    setSave({ status: "idle" });
    if (appPath) {
      appPath.navigate("/");
      return;
    }
    router.replace("/");
  }

  if (confirmation) {
    const queued = confirmation.source === "queued";
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-lg font-semibold text-emerald-950">{zh.inquiry.savedHeading}</p>
          <p className="mt-1 text-sm text-emerald-900">
            {queued ? zh.inquiry.savedOffline : zh.inquiry.savedOnline}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-emerald-800">{zh.inquiry.customerName}</dt>
              <dd className="font-medium text-emerald-950">{confirmation.customerName}</dd>
            </div>
            {confirmation.companyName !== "" && (
              <div>
                <dt className="text-xs text-emerald-800">{zh.inquiry.companyName}</dt>
                <dd className="font-medium text-emerald-950">{confirmation.companyName}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-emerald-800">{zh.inquiry.productCount}</dt>
              <dd className="font-medium text-emerald-950">
                {recordedProductsLabel(confirmation.productCount)}
              </dd>
            </div>
            {confirmation.inquiryId && (
              <div>
                <dt className="text-xs text-emerald-800">{zh.inquiry.reference}</dt>
                <dd className="font-mono text-sm break-all text-emerald-950">
                  {confirmation.inquiryId}
                </dd>
              </div>
            )}
          </dl>
          {confirmation.inquiryId && (
            <ShellHref
              href={`/inquiries/${confirmation.inquiryId}`}
              className="mt-4 block w-full rounded-xl border border-emerald-400 px-4 py-3 text-center text-sm font-semibold text-emerald-900"
            >
              {zh.inquiry.viewSaved}
            </ShellHref>
          )}
          <button
            type="button"
            onClick={startNextInquiry}
            className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            {zh.inquiry.startNext}
          </button>
        </section>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-lg font-semibold text-porcelain-950">{zh.inquiry.emptyHeading}</h1>
        <p className="text-sm text-porcelain-600">{zh.inquiry.emptyExplanation}</p>
        <ShellHref href="/" className="inline-block rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white">
          {zh.inquiry.returnToSearch}
        </ShellHref>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-porcelain-950">{zh.inquiry.currentHeading}</h1>

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
          <p className="mt-1 text-red-800">{zh.inquiry.keptOnDevice}</p>
        </div>
      )}

      <ShellHref
        href="/"
        className="block w-full rounded-xl border border-porcelain-300 px-4 py-3 text-center text-sm font-semibold text-porcelain-700"
      >
        {zh.product.continueScanning}
      </ShellHref>

      <button
        type="button"
        onClick={() => {
          void handleSave();
        }}
        disabled={!canSave}
        className="w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm disabled:bg-porcelain-300"
      >
        {saving ? zh.inquiry.saving : zh.inquiry.save}
      </button>

      {customer.name.trim() === "" && (
        <p className="text-center text-xs text-porcelain-500">
          {zh.validation.customerName}
        </p>
      )}

      {unpricedLines.length > 0 && (
        <p className="text-center text-xs font-medium text-red-700">
          {unpricedLines.length === 1
            ? zh.inquiry.lineQuoteMissing(unpricedLines[0].product.code)
            : zh.validation.quotedPrice}
        </p>
      )}
    </div>
  );
}

function ShellHref({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const appPath = useAppPathOptional();
  if (!appPath) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        appPath.navigate(href);
      }}
    >
      {children}
    </a>
  );
}
