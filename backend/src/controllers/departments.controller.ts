import { Request, Response, NextFunction } from 'express';
import * as departmentsService from '../services/departments.service';

export async function listDepartmentsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await departmentsService.listDepartments());
  } catch (err) {
    next(err);
  }
}

export async function createDepartmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await departmentsService.createDepartment(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateDepartmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await departmentsService.updateDepartment(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
