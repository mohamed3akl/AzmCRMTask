import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
}));

import { fetchTickets } from '../../src/api/tickets';
import { useAuthStore } from '../../src/stores/auth';
import DashboardView from '../../src/views/DashboardView.vue';

export function loginAs(role: 'AGENT' | 'SUPERVISOR' | 'ADMIN') {
  const auth = useAuthStore();
  auth.currentUser = {
    id: 'me',
    email: 'me@example.com',
    fullName: 'Me',
    role,
    departmentId: null,
    isActive: true,
    locale: 'en',
  };
  auth.token = 'fake-token';
}

const dashboardRoutes = [
  { path: '/', name: 'home', component: { template: '<div />' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
];

describe('DashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTickets).mockResolvedValue([]);
  });

  it("renders the agent's assigned open tickets", async () => {
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: 't1',
        subject: 'Cannot log in',
        status: 'OPEN',
        priority: 'MEDIUM',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: { id: 'me', fullName: 'Me', role: 'AGENT' },
        createdAt: new Date().toISOString(),
      },
    ]);
    loginAs('AGENT');

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(fetchTickets).toHaveBeenCalledWith({ assigneeId: 'me' });
  });
});
