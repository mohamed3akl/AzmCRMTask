import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { departmentsRouter } from './routes/departments.routes';
import { customersRouter } from './routes/customers.routes';
import { ticketCategoriesRouter } from './routes/ticketCategories.routes';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/ticket-categories', ticketCategoriesRouter);

  app.use(errorHandler);
  return app;
}
