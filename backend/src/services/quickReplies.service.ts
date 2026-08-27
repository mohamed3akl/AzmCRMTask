import { QuickReply } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listQuickReplies(): Promise<QuickReply[]> {
  return prisma.quickReply.findMany({ orderBy: { titleEn: 'asc' } });
}

export async function createQuickReply(data: {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): Promise<QuickReply> {
  return prisma.quickReply.create({ data });
}

export async function updateQuickReply(
  id: string,
  data: Partial<{ titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }>
): Promise<QuickReply> {
  try {
    return await prisma.quickReply.update({ where: { id }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Quick reply not found');
  }
}
