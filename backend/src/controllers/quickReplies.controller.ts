import { Request, Response, NextFunction } from 'express';
import * as quickRepliesService from '../services/quickReplies.service';

export async function listQuickRepliesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await quickRepliesService.listQuickReplies());
  } catch (err) {
    next(err);
  }
}

export async function createQuickReplyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await quickRepliesService.createQuickReply(req.body));
  } catch (err) {
    next(err);
  }
}

export async function updateQuickReplyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await quickRepliesService.updateQuickReply(req.params.id as string, req.body));
  } catch (err) {
    next(err);
  }
}
