import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  deactivateUserHandler,
} from '../controllers/users.controller';

const roleEnum = z.enum(['AGENT', 'SUPERVISOR', 'ADMIN']);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: roleEnum,
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: roleEnum.optional(),
  departmentId: z.string().uuid().nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

export const usersRouter = Router();

usersRouter.use(authenticate, authorize('ADMIN'));
usersRouter.get('/', listUsersHandler);
usersRouter.post('/', validate(createUserSchema), createUserHandler);
usersRouter.patch('/:id', validate(updateUserSchema), updateUserHandler);
usersRouter.post('/:id/deactivate', deactivateUserHandler);
