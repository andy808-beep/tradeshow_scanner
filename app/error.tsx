"use client";

import { zh } from "@/lib/i18n/zh-cn";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-lg font-semibold text-porcelain-950">{zh.errors.general}</h1>
      <button
        type="button"
        onClick={() => reset()}
        className="inline-block rounded-xl bg-porcelain-600 px-4 py-3 text-sm font-semibold text-white"
      >
        {zh.actions.retry}
      </button>
    </div>
  );
}
