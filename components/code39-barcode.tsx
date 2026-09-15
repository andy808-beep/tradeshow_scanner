"use client";

import { encodeCode39, isCode39Compatible, totalModules } from "@/lib/code39";

export default function Code39Barcode({
  value,
  moduleMm,
  heightMm,
  className,
}: {
  value: string;
  moduleMm: number;
  heightMm: number;
  className?: string;
}) {
  if (!isCode39Compatible(value)) return null;

  const runs = encodeCode39(value);
  const modules = totalModules(runs);
  const width = modules * moduleMm;

  let x = 0;
  const bars: Array<{ x: number; width: number }> = [];
  for (const run of runs) {
    if (run.black) bars.push({ x, width: run.modules * moduleMm });
    x += run.modules * moduleMm;
  }

  return (
    <svg
      role="img"
      aria-label={`Code 39 barcode ${value}`}
      data-encoded-value={value}
      data-barcode-format="CODE39"
      width={`${width}mm`}
      height={`${heightMm}mm`}
      viewBox={`0 0 ${width} ${heightMm}`}
      preserveAspectRatio="none"
      className={className}
      style={{ imageRendering: "pixelated" }}
    >
      <title>{value}</title>
      <rect width={width} height={heightMm} fill="#fff" />
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={0}
          width={bar.width}
          height={heightMm}
          fill="#000"
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  );
}
