import { Request, Response, NextFunction } from 'express';
import { TicketStatus } from '@prisma/client';
import * as ticketsService from '../services/tickets.service';

export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId } = req.query;
    res.json(
      await ticketsService.listTickets({
        status: status as TicketStatus | undefined,
        assigneeId: assigneeId as string | undefined,
        departmentId: departmentId as string | undefined,
        categoryId: categoryId as string | undefined,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function getTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.getTicketById(req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function createTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await ticketsService.createTicket(req.body, req.user!.id));
  } catch (err) {
    next(err);
  }
}
