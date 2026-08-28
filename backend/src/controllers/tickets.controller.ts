import { Request, Response, NextFunction } from 'express';
import { TicketStatus } from '@prisma/client';
import * as ticketsService from '../services/tickets.service';
import { attachSlaStatus } from '../services/sla.service';

export async function listTicketsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assigneeId, departmentId, categoryId, unassigned, escalated } = req.query;
    const tickets = await ticketsService.listTickets({
      status: status as TicketStatus | undefined,
      assigneeId: assigneeId as string | undefined,
      departmentId: departmentId as string | undefined,
      categoryId: categoryId as string | undefined,
      unassigned: unassigned === 'true',
      escalated: escalated === 'true',
    });
    res.json(await attachSlaStatus(tickets));
  } catch (err) {
    next(err);
  }
}

export async function getTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await ticketsService.getTicketById(req.params.id as string);
    const [withSla] = await attachSlaStatus([ticket]);
    res.json(withSla);
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

export async function updateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.updateTicketFields(req.params.id as string, req.body, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function assignTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await ticketsService.assignTicket(req.params.id as string, req.body.assigneeId, {
        id: req.user!.id,
        role: req.user!.role,
      })
    );
  } catch (err) {
    next(err);
  }
}

export async function escalateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.escalateTicket(req.params.id as string, req.body.note, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function unescalateTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.unescalateTicket(req.params.id as string, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function addTicketNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ticketsService.addTicketNote(req.params.id as string, req.body.note, req.user!.id));
  } catch (err) {
    next(err);
  }
}
