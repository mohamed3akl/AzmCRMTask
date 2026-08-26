import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from '../../src/lib/jwt';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
});

describe('jwt helpers', () => {
  it('signs and verifies a token round-trip', () => {
    const token = signToken({ sub: 'user-1', role: 'ADMIN', departmentId: null });
    const payload = verifyToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('ADMIN');
    expect(payload.departmentId).toBeNull();
  });

  it('throws on a tampered token', () => {
    const token = signToken({ sub: 'user-1', role: 'ADMIN', departmentId: null });
    expect(() => verifyToken(token + 'tampered')).toThrow();
  });
});
