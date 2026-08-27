import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
  fetchRecentTicketEvents: vi.fn(),
}));

vi.mock('../../src/api/tasks', () => ({
  fetchTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

import { fetchTickets, fetchRecentTicketEvents } from '../../src/api/tickets';
import { fetchTasks, createTask, updateTask } from '../../src/api/tasks';
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
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchRecentTicketEvents).mockResolvedValue([]);
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

  it('renders my tasks and lets the user add and complete one', async () => {
    loginAs('AGENT');
    vi.mocked(fetchTasks).mockResolvedValue([
      { id: 'task1', title: 'Call back Jane', dueAt: null, isDone: false, ownerId: 'me', ticketId: null },
    ]);
    vi.mocked(createTask).mockResolvedValue({
      id: 'task2',
      title: 'Follow up',
      dueAt: null,
      isDone: false,
      ownerId: 'me',
      ticketId: null,
    });
    vi.mocked(updateTask).mockResolvedValue({
      id: 'task1',
      title: 'Call back Jane',
      dueAt: null,
      isDone: true,
      ownerId: 'me',
      ticketId: null,
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Call back Jane');

    await wrapper.find('[data-testid="new-task-title"] input').setValue('Follow up');
    await wrapper.find('[data-testid="add-task-form"]').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createTask).toHaveBeenCalledWith({ title: 'Follow up' });

    await wrapper.find('[data-testid="task-done-task1"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTask).toHaveBeenCalledWith('task1', { isDone: true });
  });

  it('renders recent team activity', async () => {
    loginAs('AGENT');
    vi.mocked(fetchRecentTicketEvents).mockResolvedValue([
      {
        id: 'ev1',
        type: 'ESCALATED',
        oldValue: null,
        newValue: null,
        note: null,
        createdAt: new Date().toISOString(),
        author: { id: 'sup1', fullName: 'Sam Supervisor' },
        ticket: { id: 't9', subject: 'Payment failed' },
      },
    ]);

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Payment failed');
    expect(wrapper.text()).toContain('Sam Supervisor');
  });

  it('renders team-wide widgets for a supervisor', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
      if (filters.unassigned) {
        return [
          {
            id: 'u1',
            subject: 'Unassigned ticket',
            status: 'OPEN',
            priority: 'MEDIUM',
            isEscalated: false,
            customer: { id: 'c2', fullName: 'Bob Customer' },
            category: null,
            department: null,
            assignee: null,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      if (filters.escalated) {
        return [
          {
            id: 'e1',
            subject: 'Escalated ticket',
            status: 'OPEN',
            priority: 'URGENT',
            isEscalated: true,
            customer: { id: 'c3', fullName: 'Sam Customer' },
            category: null,
            department: null,
            assignee: { id: 'agent1', fullName: 'Agent One', role: 'AGENT' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      if (filters.status === 'OPEN' || filters.status === 'IN_PROGRESS') {
        return [
          {
            id: `w-${filters.status}`,
            subject: 'Workload ticket',
            status: filters.status,
            priority: 'MEDIUM',
            isEscalated: false,
            customer: { id: 'c4', fullName: 'Workload Customer' },
            category: null,
            department: null,
            assignee: { id: 'agent1', fullName: 'Agent One', role: 'AGENT' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return [];
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Unassigned ticket');
    expect(wrapper.text()).toContain('Escalated ticket');
    expect(wrapper.find('[data-testid="team-workload-widget"]').text()).toContain('Agent One');
    expect(wrapper.find('[data-testid="team-workload-widget"]').text()).toContain('2');
  });

  it('does not render team-wide widgets for an agent', async () => {
    loginAs('AGENT');
    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="unassigned-queue-widget"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="escalated-tickets-widget"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="team-workload-widget"]').exists()).toBe(false);
  });
});
