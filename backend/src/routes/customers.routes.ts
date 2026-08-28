import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  searchCustomersHandler,
  getCustomerHandler,
  createCustomerHandler,
  updateCustomerHandler,
} from '../controllers/customers.controller';

const createCustomerSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const updateCustomerSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

export const customersRouter = Router();

customersRouter.use(authenticate);
customersRouter.get('/', searchCustomersHandler);
customersRouter.get('/:id', getCustomerHandler);
customersRouter.post('/', validate(createCustomerSchema), createCustomerHandler);
customersRouter.patch('/:id', validate(updateCustomerSchema), updateCustomerHandler);
