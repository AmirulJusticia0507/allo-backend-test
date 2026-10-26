import Decimal from 'decimal.js';

// ── GitHub username for personalization (service charge) ──────────────────────
// The settlement response must include service_charge_pct and service_charge_amount.
// pct = (sum of lowercase ASCII values of the username) % 10   → 0..9 (%)
// amount = pct applied to the total group expenses.
// Computed in code, never hardcoded.
export const GITHUB_USERNAME = 'allobankdev';

export function computeServiceChargePct(username = GITHUB_USERNAME) {
  const lower = username.toLowerCase();
  let sum = 0;
  for (const ch of lower) {
    sum += ch.charCodeAt(0); // Unicode/ASCII code point
  }
  return sum % 10; // value 0..9, interpreted as a percentage
}

export function serviceChargeForExpenses(pct, totalExpenses) {
  const pctDecimal = new Decimal(pct).div(100);
  return new Decimal(totalExpenses).times(pctDecimal);
}
