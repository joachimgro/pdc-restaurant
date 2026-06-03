/**
 * Canonicalise a phone number to E.164 format for consistent DB storage and lookup.
 * Handles common UK input variants:
 *   "+44 7700 900123" → "+447700900123"
 *   "07700 900123"    → "+447700900123"
 *   "+447700900123"   → "+447700900123"
 */
export function canonicalPhone(phone: string): string {
  let p = phone.replace(/[\s\-\.\(\)]/g, "").trim();

  if (!p) return p;

  if (/^0[67]\d{9}$/.test(p)) {
    p = "+44" + p.slice(1);
  } else if (/^44[67]\d{9}$/.test(p)) {
    p = "+" + p;
  }

  return p;
}

/** Last 9 digits of a phone number, used for fuzzy duplicate lookup. */
export function phoneDigitSuffix(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}
