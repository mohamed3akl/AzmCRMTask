import { Department } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';

export async function listDepartments(): Promise<Department[]> {
  return prisma.department.findMany({ orderBy: { nameEn: 'asc' } });
}

export async function createDepartment(data: { nameEn: string; nameAr: string }): Promise<Department> {
  return prisma.department.create({ data });
}

export async function updateDepartment(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<Department> {
  try {
    return await prisma.department.update({ where: { id }, data });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Department not found');
  }
}
