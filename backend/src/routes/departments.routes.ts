import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listDepartmentsHandler,
  createDepartmentHandler,
  updateDepartmentHandler,
} from '../controllers/departments.controller';

const createDepartmentSchema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
});

const updateDepartmentSchema = z.object({
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().min(1).optional(),
});

export const departmentsRouter = Router();

departmentsRouter.use(authenticate);
departmentsRouter.get('/', listDepartmentsHandler);
departmentsRouter.post('/', authorize('ADMIN'), validate(createDepartmentSchema), createDepartmentHandler);
departmentsRouter.patch(
  '/:id',
  authorize('ADMIN'),
  validate(updateDepartmentSchema),
  updateDepartmentHandler
);
