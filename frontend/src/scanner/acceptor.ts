import { WEAK_CHECKSUM_FORMATS } from './decodeCore';

export type Candidate = { text: string; format: string };

/**
 * Decides when a decoded value is trustworthy enough to act on, and makes sure it is accepted only once.
 * Formats with mandatory check digits (Code 128, QR, PDF417, EAN…) are accepted on the first read; formats
 * without one (Code 39, Codabar, ITF) need two identical reads within `windowMs`.
 */
export function createAcceptor(windowMs = 2500) {
  let last: (Candidate & { at: number }) | null = null;
  let accepted = false;
  return {
    feed(c: Candidate, now: number): Candidate | null {
      if (accepted) return null;
      const needsConfirmation = WEAK_CHECKSUM_FORMATS.has(c.format);
      const confirmed = !needsConfirmation || (last !== null && last.text === c.text && last.format === c.format && now - last.at <= windowMs);
      last = { ...c, at: now };
      if (!confirmed) return null;
      accepted = true;
      return c;
    },
    get accepted() { return accepted; },
    reset() { last = null; accepted = false; },
  };
}
