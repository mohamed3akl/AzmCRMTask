import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { listTicketsHandler, getTicketHandler, createTicketHandler } from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const newCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const createTicketSchema = z
  .object({
    subject: z.string().min(1),
    description: z.string().min(1),
    customerId: z.string().uuid().optional(),
    newCustomer: newCustomerSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    priority: priorityEnum.optional(),
  })
  .refine((data) => Boolean(data.customerId) !== Boolean(data.newCustomer), {
    message: 'Provide exactly one of customerId or newCustomer',
  });

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
