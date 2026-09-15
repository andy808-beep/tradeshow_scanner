export const PENDING_LABEL = "Pending";

export const DEFAULT_CURRENCY = "USD";

const amountFormatter = new Intl.NumberFormat("en-US", {
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
