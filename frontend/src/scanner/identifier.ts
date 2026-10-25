// Registration-number normalisation shared by scanning, image upload and manual entry.
// The value is kept as a string: leading zeros and letter case are preserved exactly.
// Keep REGISTRATION_PATTERN in sync with backend/src/schemas.ts.

export const REGISTRATION_MAX_LENGTH = 64;
export const REGISTRATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._/-]*[A-Za-z0-9])?$/;

export type IdentifierCheck = { ok: true; value: string } | { ok: false; reason: 'empty' | 'too-long' | 'invalid-characters'; value: string };

export function normalizeRegistration(raw: string): IdentifierCheck {
  let value = raw
    // Control characters (e.g. GS1 group separators, NUL padding, CR/LF from keyboard-wedge scanners).
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  // Some Code 39 encoders include the * start/stop characters in the payload.
  if (/^\*[^*]+\*$/.test(value)) value = value.slice(1, -1).trim();
  if (!value) return { ok: false, reason: 'empty', value };
  if (value.length > REGISTRATION_MAX_LENGTH) return { ok: false, reason: 'too-long', value };
  if (!REGISTRATION_PATTERN.test(value)) return { ok: false, reason: 'invalid-characters', value };
  return { ok: true, value };
}

export function describeIdentifierProblem(check: Exclude<IdentifierCheck, { ok: true }>) {
  switch (check.reason) {
    case 'empty': return 'Enter a registration number.';
    case 'too-long': return `Registration numbers can be at most ${REGISTRATION_MAX_LENGTH} characters.`;
    case 'invalid-characters': return 'Registration numbers may only contain letters, digits, spaces, and . _ / - characters.';
  }
}

/** Redacts an identifier for diagnostics: keeps the length and the last two characters only. */
export function redact(value: string) {
  return value.length <= 2 ? '•'.repeat(value.length) : '•'.repeat(value.length - 2) + value.slice(-2);
}
