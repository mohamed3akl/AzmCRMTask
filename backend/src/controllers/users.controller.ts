import { Request, Response, NextFunction } from 'express';
import * as usersService from '../services/users.service';

export async function listUsersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.listUsers());
  } catch (err) {
    next(err);
  }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await usersService.createUser(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.updateUser(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deactivateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await usersService.deactivateUser(req.params.id as string));
  } catch (err) {
    next(err);
  }
}
