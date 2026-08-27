import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  listQuickRepliesHandler,
  createQuickReplyHandler,
  updateQuickReplyHandler,
} from '../controllers/quickReplies.controller';

const createQuickReplySchema = z.object({
  titleEn: z.string().min(1),
  titleAr: z.string().min(1),
  bodyEn: z.string().min(1),
  bodyAr: z.string().min(1),
});

const updateQuickReplySchema = z.object({
  titleEn: z.string().min(1).optional(),
  titleAr: z.string().min(1).optional(),
  bodyEn: z.string().min(1).optional(),
  bodyAr: z.string().min(1).optional(),
});

export const quickRepliesRouter = Router();

quickRepliesRouter.use(authenticate);
quickRepliesRouter.get('/', listQuickRepliesHandler);
quickRepliesRouter.post(
  '/',
  authorize('ADMIN'),
  validate(createQuickReplySchema),
  createQuickReplyHandler
);
quickRepliesRouter.patch(
  '/:id',
  authorize('ADMIN'),
  validate(updateQuickReplySchema),
  updateQuickReplyHandler
);
