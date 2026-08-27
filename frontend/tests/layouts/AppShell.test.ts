import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';
import { useAuthStore } from '../../src/stores/auth';
import AppShell from '../../src/layouts/AppShell.vue';

describe('AppShell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.dir = '';
    document.documentElement.lang = '';
  });

  it('switches document direction to rtl when Arabic is selected', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    const arButton = wrapper.findAll('button').find((btn) => btn.text() === 'AR');
    expect(arButton).toBeTruthy();
    await arButton!.trigger('click');

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('logs out and redirects to login on logout click', async () => {
    const auth = useAuthStore();
    auth.currentUser = {
      id: '1',
      email: 'a@b.com',
      fullName: 'A B',
      role: 'ADMIN',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };
    auth.token = 'fake-token';

    const wrapper = mountWithPlugins(AppShell, {}, [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/users', name: 'users', component: { template: '<div />' } },
      { path: '/departments', name: 'departments', component: { template: '<div />' } },
      { path: '/ticket-categories', name: 'ticket-categories', component: { template: '<div />' } },
    ]);

    await wrapper.find('[data-testid="user-menu-activator"]').trigger('click');
    await wrapper.find('[data-testid="logout-item"]').trigger('click');

    expect(auth.isAuthenticated).toBe(false);
  });
});
