"use client";

import { useState } from "react";
import { clampQuantity } from "@/lib/inquiry";

const stepClasses =
  "h-11 w-11 shrink-0 rounded-lg border border-porcelain-300 bg-white text-lg font-semibold text-porcelain-700 disabled:text-porcelain-300";

export default function QuantityStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (quantity: number) => void;
  label: string;
}) {
  // Non-null only while the field is being typed into, so the store stays the
  // source of truth once focus leaves.
  const [draft, setDraft] = useState<string | null>(null);

  function handleChange(next: string) {
    const digits = next.replace(/[^0-9]/g, "");
    setDraft(digits);
    if (digits !== "") onChange(clampQuantity(Number(digits)));
  }

  function step(delta: number) {
    setDraft(null);
    onChange(clampQuantity(value + delta));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= 1}
        aria-label="Decrease quantity"
        className={stepClasses}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setDraft(null)}
        aria-label={label}
        className="h-11 w-16 rounded-lg border border-porcelain-300 bg-white text-center text-base font-semibold text-porcelain-950 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Increase quantity"
        className={stepClasses}
      >
        +
      </button>
    </div>
  );
}
