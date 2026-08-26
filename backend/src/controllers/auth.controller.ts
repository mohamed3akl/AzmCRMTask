import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
