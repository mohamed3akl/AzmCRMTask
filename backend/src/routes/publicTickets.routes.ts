import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { createRateLimiter } from '../middleware/rateLimit';
import { createPublicTicketHandler } from '../controllers/publicTickets.controller';

const createPublicTicketSchema = z
  .object({
    fullName: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
    subject: z.string().min(1),
    description: z.string().min(1),
  })
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: 'Provide at least one of email or phone',
  });

const publicTicketRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

export const publicTicketsRouter = Router();

publicTicketsRouter.use(publicTicketRateLimiter);
publicTicketsRouter.post('/', validate(createPublicTicketSchema), createPublicTicketHandler);
