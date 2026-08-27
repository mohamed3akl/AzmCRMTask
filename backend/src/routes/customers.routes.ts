import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { searchCustomersHandler } from '../controllers/customers.controller';

export const customersRouter = Router();

customersRouter.use(authenticate);
customersRouter.get('/', searchCustomersHandler);
