import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { loginHandler, logoutHandler } from '../controllers/auth.controller';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', validate(loginSchema), loginHandler);
authRouter.post('/logout', logoutHandler);
