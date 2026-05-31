export function currencyFormat(value: number, currency = "USD") {
  if (!Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) > 1000 ? 2 : 4
  }).format(value);
}

export function percentFormat(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function plainPrice(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(value > 1000 ? 2 : 4).replace(/\.?0+$/, "");
}
