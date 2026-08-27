import { Request, Response, NextFunction } from 'express';
import * as tasksService from '../services/tasks.service';

export async function listTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { done, ticketId } = req.query;
    res.json(
      await tasksService.listTasks(req.user!.id, {
        done: done === undefined ? undefined : done === 'true',
        ticketId: ticketId as string | undefined,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function createTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await tasksService.createTask(req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await tasksService.updateTask(req.params.id as string, req.user!.id, req.body));
  } catch (err) {
    next(err);
  }
}

export async function deleteTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await tasksService.deleteTask(req.params.id as string, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
