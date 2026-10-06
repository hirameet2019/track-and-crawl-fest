import { LOCALE } from "@/config/site";

/**
 * An amount stored in the smallest currency unit (centavos), formatted in the
 * configured locale and currency: 15000 -> "₱150.00" for en-PH / PHP.
 */
export function formatMoney(minorUnits: number): string {
  return new Intl.NumberFormat(LOCALE.locale, {
    style: "currency",
    currency: LOCALE.currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/**
 * Older name, used across the app from when the currency was always pesos. It
 * now follows LOCALE.currency like formatMoney; prefer formatMoney in new code.
 */
export const php = formatMoney;
