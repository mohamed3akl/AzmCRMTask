import { Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { HttpError } from '../lib/httpError';

type PublicUser = Omit<User, 'passwordHash'>;

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({ orderBy: { fullName: 'asc' } });
  return users.map(toPublicUser);
}

export async function createUser(data: {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  departmentId?: string | null;
  locale?: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new HttpError(400, 'EMAIL_TAKEN', 'A user with this email already exists');
  }
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName,
      role: data.role,
      departmentId: data.departmentId ?? null,
      locale: data.locale ?? 'en',
    },
  });
  return toPublicUser(user);
}

export async function updateUser(
  id: string,
  data: Partial<{ fullName: string; role: Role; departmentId: string | null; locale: string }>
): Promise<PublicUser> {
  try {
    const user = await prisma.user.update({ where: { id }, data });
    return toPublicUser(user);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }
}

export async function deactivateUser(id: string): Promise<PublicUser> {
  try {
    const user = await prisma.user.update({ where: { id }, data: { isActive: false } });
    return toPublicUser(user);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }
}
