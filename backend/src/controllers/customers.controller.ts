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

export async function getCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await customersService.getCustomerById(req.params.id as string));
  } catch (err) {
    next(err);
  }
}

export async function createCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await customersService.createCustomer(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await customersService.updateCustomer(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
