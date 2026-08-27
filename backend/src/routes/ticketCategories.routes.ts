import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listTicketCategoriesHandler,
  createTicketCategoryHandler,
  updateTicketCategoryHandler,
} from '../controllers/ticketCategories.controller';

const createTicketCategorySchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

const updateTicketCategorySchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
});

export const ticketCategoriesRouter = Router();

ticketCategoriesRouter.use(authenticate, authorize('ADMIN'));
ticketCategoriesRouter.get('/', listTicketCategoriesHandler);
ticketCategoriesRouter.post('/', validate(createTicketCategorySchema), createTicketCategoryHandler);
ticketCategoriesRouter.patch('/:id', validate(updateTicketCategorySchema), updateTicketCategoryHandler);
