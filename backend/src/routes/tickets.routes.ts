import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTicketsHandler,
  getTicketHandler,
  createTicketHandler,
  updateTicketHandler,
  assignTicketHandler,
  escalateTicketHandler,
  unescalateTicketHandler,
  addTicketNoteHandler,
} from '../controllers/tickets.controller';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

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

const updateTicketSchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

const assignTicketSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});

const escalateTicketSchema = z.object({
  note: z.string().min(1).optional(),
});

const addNoteSchema = z.object({
  note: z.string().min(1),
});

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);
ticketsRouter.get('/', listTicketsHandler);
ticketsRouter.post('/', validate(createTicketSchema), createTicketHandler);
ticketsRouter.get('/:id', getTicketHandler);
ticketsRouter.patch('/:id', validate(updateTicketSchema), updateTicketHandler);
ticketsRouter.post('/:id/assign', validate(assignTicketSchema), assignTicketHandler);
ticketsRouter.post('/:id/escalate', validate(escalateTicketSchema), escalateTicketHandler);
ticketsRouter.post('/:id/unescalate', unescalateTicketHandler);
ticketsRouter.post('/:id/notes', validate(addNoteSchema), addTicketNoteHandler);
