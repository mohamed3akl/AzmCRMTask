import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { listSlaTargetsHandler, updateSlaTargetHandler } from '../controllers/slaTargets.controller';

const updateSlaTargetSchema = z.object({
  responseMinutes: z.number().int().positive().optional(),
  resolutionMinutes: z.number().int().positive().optional(),
});

export const slaTargetsRouter = Router();

slaTargetsRouter.use(authenticate);
slaTargetsRouter.get('/', listSlaTargetsHandler);
slaTargetsRouter.patch('/:priority', authorize('ADMIN'), validate(updateSlaTargetSchema), updateSlaTargetHandler);
