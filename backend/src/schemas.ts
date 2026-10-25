import { z } from 'zod';

export const uuidSchema = z.string().uuid();

// Keep in sync with frontend/src/scanner/identifier.ts. Registration numbers stay strings so
// leading zeros and letter case are preserved exactly as printed/encoded on the ID card.
export const REGISTRATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._/-]*[A-Za-z0-9])?$/;
export const registrationSchema = z.string()
  .transform(v => v.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Registration number is required').max(64, 'Registration number is too long').regex(REGISTRATION_PATTERN, 'Registration number contains unsupported characters'));

export const parcelSchema = z.object({
  registrationNo: registrationSchema,
  studentName: z.string().trim().min(1).max(120),
  trackingId: z.string().trim().min(1).max(100),
  paymentType: z.enum(['PREPAID', 'COD']),
  paymentStatus: z.enum(['PAID', 'PENDING', 'NOT_APPLICABLE']).optional(),
});
export const storeSchema = z.object({ compartmentId: uuidSchema });
export const commandResultSchema = z.object({ result: z.enum(['EXECUTED', 'FAILED']) });
const eventMetadata = {
  sourceEventKey: z.string().trim().min(1).max(100),
  occurredAt: z.string().datetime().optional(),
};
export const eventSchema = z.union([
  z.object({ ...eventMetadata, parcelId: uuidSchema, compartmentId: uuidSchema }).strict(),
  z.object({ ...eventMetadata, slotNo: z.number().int().positive(), compartmentNo: z.number().int().positive() }).strict(),
]);
