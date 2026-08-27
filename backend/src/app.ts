import express, { Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { departmentsRouter } from './routes/departments.routes';
import { customersRouter } from './routes/customers.routes';
import { ticketCategoriesRouter } from './routes/ticketCategories.routes';
import { ticketsRouter } from './routes/tickets.routes';
import { tasksRouter } from './routes/tasks.routes';
import { quickRepliesRouter } from './routes/quickReplies.routes';
import { ticketEventsRouter } from './routes/ticketEvents.routes';
import { publicTicketsRouter } from './routes/publicTickets.routes';

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
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/quick-replies', quickRepliesRouter);
  app.use('/api/ticket-events', ticketEventsRouter);
  app.use('/api/public/tickets', publicTicketsRouter);

  app.use(errorHandler);
  return app;
}
