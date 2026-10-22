import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
export class HttpError extends Error {
    constructor(public status: number, message: string, public code = 'REQUEST_FAILED') {
        super(message);
    }
}
export const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
};
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const p = schema.safeParse(value);
    if (!p.success)
        throw new HttpError(400, p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 'INVALID_INPUT');
    return p.data;
}
export const id = z.string().uuid();
export const registration = z.string().trim().min(3).max(30).regex(/^[a-z0-9-]+$/i).transform(s => s.toUpperCase());
