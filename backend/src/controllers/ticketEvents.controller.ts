import { Request, Response, NextFunction } from 'express';
import * as ticketsService from '../services/tickets.service';

export async function listRecentTicketEventsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await ticketsService.listRecentTicketEvents(limit));
  } catch (err) {
    next(err);
  }
}
