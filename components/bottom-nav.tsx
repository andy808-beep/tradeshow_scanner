"use client";

import { useAppPath } from "./app-path";
import { useInquiry } from "./inquiry-store";

function navClasses(isActive: boolean): string {
  return [
    "relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
    isActive ? "text-porcelain-700" : "text-porcelain-400",
  ].join(" ");
}

export default function BottomNav() {
  const { path, navigate } = useAppPath();
  const { lines } = useInquiry();

  const onInquiry = path === "/inquiry";
  const onLabels = path === "/labels";
  const onSaved = path === "/inquiries" || path.startsWith("/inquiries/");
  const onSearch = !onInquiry && !onLabels && !onSaved;

  function handleNav(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }

  return (
    <nav className="print-chrome fixed inset-x-0 bottom-0 z-20 border-t border-porcelain-200 bg-white print:hidden">
      {/* Native anchors keep tab switches on the cached shell. Next <Link> would fetch RSC. */}
      <div className="mx-auto flex max-w-md">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- client shell navigation */}
        <a
          href="/"
          onClick={(event) => handleNav(event, "/")}
          className={navClasses(onSearch)}
          aria-current={onSearch ? "page" : undefined}
        >
          <span aria-hidden>🔍</span>
          Search
        </a>
        <a
          href="/inquiry"
          onClick={(event) => handleNav(event, "/inquiry")}
          className={navClasses(onInquiry)}
          aria-current={onInquiry ? "page" : undefined}
        >
          <span aria-hidden>📋</span>
          Inquiry
          {lines.length > 0 && (
            <span className="absolute top-1 right-1/2 -mr-5 inline-flex min-w-5 justify-center rounded-full bg-porcelain-600 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
              {lines.length}
            </span>
          )}
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- client shell navigation */}
        <a
          href="/inquiries"
          onClick={(event) => handleNav(event, "/inquiries")}
          className={navClasses(onSaved)}
          aria-current={onSaved ? "page" : undefined}
        >
          <span aria-hidden>📁</span>
          Saved
        </a>
        <a
          href="/labels"
          onClick={(event) => handleNav(event, "/labels")}
          className={navClasses(onLabels)}
          aria-current={onLabels ? "page" : undefined}
        >
          <span aria-hidden>🏷</span>
          Labels
        </a>
      </div>
    </nav>
  );
}
