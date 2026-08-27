import { Request, Response, NextFunction } from 'express';
import * as ticketsService from '../services/tickets.service';

export async function createPublicTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { fullName, email, phone, subject, description } = req.body;
    const ticket = await ticketsService.createTicket(
      {
        subject,
        description,
        newCustomer: { fullName, email, phone },
      },
      null,
      'WEB_FORM'
    );
    res.status(201).json({ reference: ticket.id.slice(0, 8).toUpperCase() });
  } catch (err) {
    next(err);
  }
}
