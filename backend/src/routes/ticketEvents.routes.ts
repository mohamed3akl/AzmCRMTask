import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { listRecentTicketEventsHandler } from '../controllers/ticketEvents.controller';

export const ticketEventsRouter = Router();

ticketEventsRouter.use(authenticate);
ticketEventsRouter.get('/recent', listRecentTicketEventsHandler);
