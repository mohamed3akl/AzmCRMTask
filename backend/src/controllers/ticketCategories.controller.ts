import { Request, Response, NextFunction } from 'express';
import * as ticketCategoriesService from '../services/ticketCategories.service';

export async function listTicketCategoriesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketCategoriesService.listTicketCategories());
  } catch (err) {
    next(err);
  }
}

export async function createTicketCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await ticketCategoriesService.createTicketCategory(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateTicketCategoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketCategoriesService.updateTicketCategory(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
