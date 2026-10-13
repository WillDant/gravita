import { getLocale } from "@/shared/i18n/i18n";

const formats = new Map<string, Intl.NumberFormat>();

/** Dollars as people read a bill: "$4.20", "$1,000.00" (pt-BR: "US$ 4,20"). */
export function usd(n: number, digits = 2): string {
  const locale = getLocale();
  const key = `${locale}:${digits}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formats.set(key, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}
