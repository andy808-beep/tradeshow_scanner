"use client";

import { zh } from "@/lib/i18n/zh-cn";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <h1>{zh.errors.general}</h1>
        <button type="button" onClick={() => reset()}>
          {zh.actions.retry}
        </button>
      </body>
    </html>
  );
}
