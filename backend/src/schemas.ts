import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const parcelSchema = z.object({
  registrationNo: z.string().trim().min(1),
  studentName: z.string().trim().min(1),
  trackingId: z.string().trim().min(1),
  paymentType: z.enum(['PREPAID', 'COD']),
  paymentStatus: z.enum(['PAID', 'PENDING', 'NOT_APPLICABLE']).optional(),
});
export const storeSchema = z.object({ compartmentId: uuidSchema });
export const commandResultSchema = z.object({ result: z.enum(['EXECUTED', 'FAILED']) });
export const eventSchema = z.object({
  sourceEventKey: z.string().min(1).max(100),
  parcelId: uuidSchema,
  compartmentId: uuidSchema,
  occurredAt: z.string().datetime().optional(),
});
