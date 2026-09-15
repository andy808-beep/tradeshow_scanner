import { PENDING_LABEL } from "@/lib/format";

export function PendingBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-porcelain-100 px-2 py-0.5 text-xs font-medium tracking-wide text-porcelain-600 uppercase">
      {PENDING_LABEL}
    </span>
  );
}

/**
 * Renders `value`, falling back to the Pending badge when it is `null`, so no
 * screen can accidentally present an unconfirmed field as a real value.
 */
export function PendingValue({ value }: { value: string | null }) {
  if (value === null) return <PendingBadge />;
  return <>{value}</>;
}

export function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-porcelain-100 py-3 last:border-b-0">
      <dt className="shrink-0 text-sm text-porcelain-600">{label}</dt>
      <dd className="text-right text-sm font-medium text-porcelain-950">
        <PendingValue value={value} />
      </dd>
    </div>
  );
}
