import { Router } from 'express';
import { z } from 'zod';
import { requireAccount } from '../middleware/auth';
import { route, parse, id, HttpError } from '../http';
import { createPickup, pickupStatus, workflowTx, audit } from '../workflows';
const router = Router();
const eligible: import('express').RequestHandler = (req, _res, next) => {
    if (req.account?.role === 'OPERATOR' || (req.account?.email_verified_at && req.account?.approved_at))
        return next();
    next(new HttpError(403, 'Verify your email and obtain student identity approval first.'));
};
router.post('/parcels/:parcelId/pickups', requireAccount, eligible, route(async (req, res) => {
    const note = req.account!.role === 'OPERATOR' ? parse(z.object({ collectorVerified: z.literal(true), verificationNote: z.string().trim().min(5).max(500) }), req.body).verificationNote : null;
    const out = await workflowTx(c => createPickup(c, parse(id, req.params.parcelId), req.account!, note));
    res.status(202).json(out);
}));
router.get('/pickups/:pickupId', requireAccount, eligible, route(async (req, res) => res.json(await workflowTx(c => pickupStatus(c, parse(id, req.params.pickupId), req.account!)))));
router.post('/pickups/:pickupId/cancel', requireAccount, eligible, route(async (req, res) => {
    const out = await workflowTx(async (c) => {
        const p = await pickupStatus(c, parse(id, req.params.pickupId), req.account!);
        if (p.status === 'CANCELLED')
            return p;
        if (p.status !== 'ACTIVE')
            throw new HttpError(409, 'Pickup has already ended.');
        const b = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
        await c.query(`UPDATE pickup_attempts SET status='CANCELLED',completed_at=now() WHERE pickup_id=$1`, [p.pickup_id]);
        await c.query(`UPDATE hardware_commands SET command_status='FAILED',completed_at=now() WHERE command_id=$1 AND command_status IN ('PENDING','ACKNOWLEDGED')`, [p.command_id]);
        await audit(c, req.account!.account_id, p.parcel_id, 'PICKUP_CANCELLED', { reason: b.reason });
        return { ...p, status: 'CANCELLED' };
    });
    res.json(out);
}));
export default router;
