"use client";

import { zh } from "@/lib/i18n/zh-cn";

export default function ScanButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={zh.scanner.open}
      className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-porcelain-300 bg-porcelain-50 px-4 text-porcelain-700 transition-colors active:bg-porcelain-100"
    >
      <span aria-hidden className="text-lg leading-none">
        ▣
      </span>
      <span className="mt-0.5 text-sm font-semibold">{zh.scanner.scan}</span>
    </button>
  );
}
