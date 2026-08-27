import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  listTasksHandler,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
} from '../controllers/tasks.controller';

const createTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.coerce.date().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
  isDone: z.boolean().optional(),
});

export const tasksRouter = Router();

tasksRouter.use(authenticate);
tasksRouter.get('/', listTasksHandler);
tasksRouter.post('/', validate(createTaskSchema), createTaskHandler);
tasksRouter.patch('/:id', validate(updateTaskSchema), updateTaskHandler);
tasksRouter.delete('/:id', deleteTaskHandler);
