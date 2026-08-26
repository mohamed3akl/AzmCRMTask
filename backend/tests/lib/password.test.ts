import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../../src/lib/password';

describe('password helpers', () => {
  it('hashes a password so it no longer matches the plain text', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
  });

  it('confirms a correct password matches its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(comparePassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(comparePassword('wrong password', hash)).resolves.toBe(false);
  });
});
