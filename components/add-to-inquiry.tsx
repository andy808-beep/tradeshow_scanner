"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/types";
import { useInquiry } from "./inquiry-store";

export default function AddToInquiry({ product }: { product: Product }) {
  const { findLine, addProduct } = useInquiry();
  const [rejection, setRejection] = useState<string | null>(null);
  const line = findLine(product.id);

  function handleAdd() {
    const result = addProduct(product);
    setRejection(result.ok ? null : result.reason);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAdd}
        className="w-full rounded-xl bg-porcelain-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition-colors active:bg-porcelain-700"
      >
        {line ? "Add one more" : "Add to inquiry"}
      </button>

      {rejection && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
          {rejection}
        </p>
      )}

      {line && (
        <p className="text-center text-sm text-porcelain-600">
          {line.quantity} in this inquiry ·{" "}
          <Link href="/inquiry" className="font-semibold text-porcelain-700 underline">
            Open inquiry
          </Link>
        </p>
      )}
    </div>
  );
}
