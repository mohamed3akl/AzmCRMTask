import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TicketPriority } from '@prisma/client';
import { HttpError } from '../lib/httpError';
import * as slaTargetsService from '../services/slaTargets.service';

const priorityParamSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export async function listSlaTargetsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await slaTargetsService.listSlaTargets());
  } catch (err) {
    next(err);
  }
}

export async function updateSlaTargetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = priorityParamSchema.safeParse(req.params.priority);
    if (!result.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid priority');
    }
    res.json(await slaTargetsService.updateSlaTarget(result.data as TicketPriority, req.body));
  } catch (err) {
    next(err);
  }
}
