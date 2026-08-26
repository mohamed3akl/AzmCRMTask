import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../src/api/auth', () => ({
  loginRequest: vi.fn(),
}));

import { loginRequest } from '../../src/api/auth';
import { useAuthStore } from '../../src/stores/auth';

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(loginRequest).mockReset();
  });

  it('starts unauthenticated', () => {
    const store = useAuthStore();
    expect(store.isAuthenticated).toBe(false);
  });

  it('stores the token and user on successful login', async () => {
    vi.mocked(loginRequest).mockResolvedValue({
      token: 'fake-token',
      user: { id: '1', email: 'a@b.com', fullName: 'A B', role: 'ADMIN', departmentId: null, isActive: true, locale: 'en' },
    });
    const store = useAuthStore();
    await store.login('a@b.com', 'password');
    expect(store.isAuthenticated).toBe(true);
    expect(store.currentUser?.email).toBe('a@b.com');
    expect(localStorage.getItem('azmcrm_token')).toBe('fake-token');
  });

  it('clears state on logout', async () => {
    vi.mocked(loginRequest).mockResolvedValue({
      token: 'fake-token',
      user: { id: '1', email: 'a@b.com', fullName: 'A B', role: 'ADMIN', departmentId: null, isActive: true, locale: 'en' },
    });
    const store = useAuthStore();
    await store.login('a@b.com', 'password');
    store.logout();
    expect(store.isAuthenticated).toBe(false);
    expect(store.currentUser).toBeNull();
    expect(localStorage.getItem('azmcrm_token')).toBeNull();
  });
});
