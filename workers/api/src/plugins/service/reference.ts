/**
 * Booking references. Six characters of Crockford base-32 — no I, L, O or U.
 *
 * Guests read these out over the phone and staff type them back. I/1, O/0 and
 * L/1 are the pairs that cost a call; U is excluded because Crockford drops it
 * to avoid accidental obscenities.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 6;

export function generateReference(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);

  let out = "";
  for (const byte of bytes) {
    // 256 is not a multiple of 32, but 32 divides 256 exactly (8 × 32), so a
    // plain modulo is uniform here.
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** Normalise a reference typed by a human: Crockford's I/L → 1, O → 0. */
export function normaliseReference(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}
