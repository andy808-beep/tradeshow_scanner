import { zh } from "@/lib/i18n/zh-cn";

export const PENDING_LABEL = zh.product.pending;

export const DEFAULT_CURRENCY = "USD";

const amountFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number): string {
  return amountFormatter.format(value);
}

export function currencySymbol(currency: string): string {
  return currency === "USD" ? "US$" : `${currency} `;
}

export function formatMoney(value: number, currency: string): string {
  return `${currencySymbol(currency)}${formatAmount(value)}`;
}

/** Employee-facing local time, for example 2026年10月1日 16:30. */
export function formatZhDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`;
}
