// Numbers as platforms display them: "1,234", "1.2K", "3.4M", "1.1B". Pure
// and Zod-free, so the form and the server read them the same way.

export const MAX_COUNT = 1_000_000_000_000;
/** Ten hours: longer than any short- or long-form video worth breaking down. */
export const MAX_DURATION_SECONDS = 36_000;

export type CountResult = { ok: true; value: number | null; rounded: boolean } | { ok: false };

const MULTIPLIERS: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
const PLAIN = /^(\d{1,3}(,\d{3})+|\d+)$/;
const SHORTHAND = /^(\d+(?:\.\d+)?)([kmb])$/i;

/**
 * A blank field is `null` (not shown on the platform). Shorthand values are
 * `rounded`: the platform showed an approximation, so rates are approximate.
 */
export function parseCount(raw: string): CountResult {
  const input = raw.replace(/\s+/g, "");
  if (!input) return { ok: true, value: null, rounded: false };

  if (PLAIN.test(input)) {
    const value = Number(input.replace(/,/g, ""));
    return value <= MAX_COUNT ? { ok: true, value, rounded: false } : { ok: false };
  }
  const short = SHORTHAND.exec(input);
  if (short) {
    const value = Math.round(Number(short[1]) * MULTIPLIERS[short[2].toLowerCase()]);
    return value <= MAX_COUNT ? { ok: true, value, rounded: true } : { ok: false };
  }
  return { ok: false };
}

export type DurationResult = { ok: true; value: number | null } | { ok: false };

/** "95", "1:35" or "1:02:03" → seconds. Blank is null. */
export function parseDuration(raw: string): DurationResult {
  const input = raw.replace(/\s+/g, "");
  if (!input) return { ok: true, value: null };
  let seconds: number;
  if (/^\d+$/.test(input)) seconds = Number(input);
  else if (/^\d{1,2}(:[0-5]\d){1,2}$/.test(input)) seconds = input.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  else return { ok: false };
  return seconds > 0 && seconds <= MAX_DURATION_SECONDS ? { ok: true, value: seconds } : { ok: false };
}
