import { Request, Response, NextFunction } from 'express';
import * as customersService from '../services/customers.service';

export async function searchCustomersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    res.json(await customersService.searchCustomers(query));
  } catch (err) {
    next(err);
  }
}
