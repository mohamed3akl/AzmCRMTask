import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/auth', () => ({
  loginRequest: vi.fn(),
}));

import { loginRequest } from '../../src/api/auth';
import LoginView from '../../src/views/LoginView.vue';

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(loginRequest).mockReset();
  });

  it('shows an error message on failed login', async () => {
    vi.mocked(loginRequest).mockRejectedValue(new Error('Invalid credentials'));
    const wrapper = mountWithPlugins(LoginView, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: LoginView },
    ]);

    await wrapper.find('input[type="email"]').setValue('a@b.com');
    await wrapper.find('input[type="password"]').setValue('wrong');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain('Invalid email or password');
  });
});
