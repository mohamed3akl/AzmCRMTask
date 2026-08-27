import { Task } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listTasks(
  ownerId: string,
  filters: { done?: boolean; ticketId?: string }
): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      ownerId,
      isDone: filters.done,
      ticketId: filters.ticketId,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createTask(
  ownerId: string,
  data: { title: string; dueAt?: Date | null; ticketId?: string | null }
): Promise<Task> {
  return prisma.task.create({
    data: {
      title: data.title,
      dueAt: data.dueAt ?? null,
      ticketId: data.ticketId ?? null,
      ownerId,
    },
  });
}

async function requireOwnedTask(id: string, ownerId: string): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.ownerId !== ownerId) {
    throw new HttpError(404, 'NOT_FOUND', 'Task not found');
  }
  return task;
}

export async function updateTask(
  id: string,
  ownerId: string,
  data: Partial<{ title: string; dueAt: Date | null; ticketId: string | null; isDone: boolean }>
): Promise<Task> {
  await requireOwnedTask(id, ownerId);
  return prisma.task.update({ where: { id }, data });
}

export async function deleteTask(id: string, ownerId: string): Promise<void> {
  await requireOwnedTask(id, ownerId);
  await prisma.task.delete({ where: { id } });
}
