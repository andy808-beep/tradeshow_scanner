"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useInquiry } from "./inquiry-store";

function navClasses(isActive: boolean): string {
  return [
    "relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
    isActive ? "text-porcelain-700" : "text-porcelain-400",
  ].join(" ");
}

export default function BottomNav() {
  const pathname = usePathname();
  const { totals } = useInquiry();

  const onInquiry = pathname === "/inquiry";
  const onLabels = pathname === "/labels";
  const onSearch = !onInquiry && !onLabels;

  return (
    <nav className="print-chrome fixed inset-x-0 bottom-0 z-20 border-t border-porcelain-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-md">
        <Link href="/" className={navClasses(onSearch)} aria-current={onSearch ? "page" : undefined}>
          <span aria-hidden>🔍</span>
          Search
        </Link>
        <Link
          href="/inquiry"
          className={navClasses(onInquiry)}
          aria-current={onInquiry ? "page" : undefined}
        >
          <span aria-hidden>📋</span>
          Inquiry
          {totals.lineCount > 0 && (
            <span className="absolute top-1 right-1/2 -mr-5 inline-flex min-w-5 justify-center rounded-full bg-porcelain-600 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
              {totals.lineCount}
            </span>
          )}
        </Link>
        <Link
          href="/labels"
          className={navClasses(onLabels)}
          aria-current={onLabels ? "page" : undefined}
        >
          <span aria-hidden>🏷</span>
          Labels
        </Link>
      </div>
    </nav>
  );
}
