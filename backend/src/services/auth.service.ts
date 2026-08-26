import { prisma } from '../lib/prisma';
import { comparePassword } from '../lib/password';
import { signToken } from '../lib/jwt';
import { HttpError } from '../lib/httpError';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = signToken({ sub: user.id, role: user.role, departmentId: user.departmentId });
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return { token, user: publicUser };
}
