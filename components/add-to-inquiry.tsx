"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/types";
import { LOOKUP_MESSAGES } from "@/lib/offline/constants";
import { useAppPathOptional } from "./app-path";
import { useCatalogueOptional } from "./catalogue-provider";
import { useInquiry } from "./inquiry-store";

export default function AddToInquiry({
  product,
  onScanAnother,
}: {
  product: Product;
  onScanAnother?: () => void;
}) {
  const { findLine, addProduct } = useInquiry();
  const catalogue = useCatalogueOptional();
  const access = catalogue?.access;
  const [rejection, setRejection] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const line = findLine(product.id);

  function handleAdd() {
    if (line) return;
    if (access && access.kind !== "ready" && !catalogue?.online) {
      setRejection(
        access.kind === "expired" ? LOOKUP_MESSAGES.expired : LOOKUP_MESSAGES.unsynced,
      );
      return;
    }

    const result = addProduct(product);
    if (result.ok) {
      setRejection(null);
      setJustAdded(true);
      return;
    }
    setRejection(result.reason);
  }

  const scanAnother = onScanAnother ? (
    <button
      type="button"
      onClick={onScanAnother}
      className="w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-colors active:bg-porcelain-700"
    >
      Scan another product
    </button>
  ) : (
    <ShellHref
      href="/"
      className="block w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-center text-base font-semibold text-white shadow-sm"
    >
      Scan another product
    </ShellHref>
  );

  if (line) {
    return (
      <div className="space-y-2">
        <p className="w-full rounded-xl bg-emerald-50 px-4 py-3.5 text-center text-base font-semibold text-emerald-900">
          {justAdded ? "Added to inquiry" : "Already in inquiry"}
        </p>
        {scanAnother}
        <ShellHref
          href="/inquiry"
          className="block w-full rounded-xl border border-porcelain-300 px-4 py-3 text-center text-sm font-semibold text-porcelain-700"
        >
          View inquiry
        </ShellHref>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAdd}
        className="w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-colors active:bg-porcelain-700"
      >
        Add to inquiry
      </button>

      {rejection && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
          {rejection}
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
