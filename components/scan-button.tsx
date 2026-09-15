"use client";

export default function ScanButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scan a barcode with the camera"
      className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-porcelain-300 bg-porcelain-50 px-4 text-porcelain-700 transition-colors active:bg-porcelain-100"
    >
      <span aria-hidden className="text-lg leading-none">
        ▣
      </span>
      <span className="mt-0.5 text-sm font-semibold">Scan</span>
    </button>
  );
}
