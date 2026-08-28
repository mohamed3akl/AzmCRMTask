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
    expect(createTask).toHaveBeenCalledWith({ title: 'Follow up', dueAt: null, ticketId: null });

    await wrapper.find('[data-testid="task-done-task1"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateTask).toHaveBeenCalledWith('task1', { isDone: true });
  });

  it('lets the user set a due date when adding a task', async () => {
    loginAs('AGENT');
    vi.mocked(createTask).mockResolvedValue({
      id: 'task3',
      title: 'Follow up',
      dueAt: '2026-09-01T10:00:00.000Z',
      isDone: false,
      ownerId: 'me',
      ticketId: null,
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="new-task-title"] input').setValue('Follow up');
    await wrapper.find('[data-testid="new-task-due-at"] input').setValue('2026-09-01T10:00');
    await wrapper.find('[data-testid="add-task-form"]').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTask).toHaveBeenCalledWith({
      title: 'Follow up',
      dueAt: new Date('2026-09-01T10:00').toISOString(),
      ticketId: null,
    });
  });

  it('shows a task\'s due date and linked ticket subject', async () => {
    loginAs('AGENT');
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: 'ticket-1',
        subject: 'Payment issue',
        status: 'OPEN',
        priority: 'MEDIUM',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(fetchTasks).mockResolvedValue([
      {
        id: 'task4',
        title: 'Call about payment',
        dueAt: '2026-09-01T10:00:00.000Z',
        isDone: false,
        ownerId: 'me',
        ticketId: 'ticket-1',
      },
    ]);

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const widget = wrapper.find('[data-testid="my-tasks-widget"]');
    expect(widget.text()).toContain('Call about payment');
    expect(widget.text()).toContain('Payment issue');
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
    expect(wrapper.find('[data-testid="breached-tickets-widget"]').exists()).toBe(false);
  });

  it('shows an error state in My Tickets when the ticket fetch fails', async () => {
    loginAs('AGENT');
    vi.mocked(fetchTickets).mockRejectedValue(new Error('network error'));

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const widget = wrapper.find('[data-testid="my-tickets-widget"]');
    expect(widget.find('[data-testid="widget-error"]').exists()).toBe(true);
    expect(widget.text()).not.toContain('No tickets assigned to you.');
  });

  it('shows error states across all supervisor widgets when their fetches fail', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockRejectedValue(new Error('network error'));
    vi.mocked(fetchTasks).mockRejectedValue(new Error('network error'));
    vi.mocked(fetchRecentTicketEvents).mockRejectedValue(new Error('network error'));

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    for (const testid of [
      'my-tickets-widget',
      'my-tasks-widget',
      'team-activity-widget',
      'unassigned-queue-widget',
      'escalated-tickets-widget',
      'team-workload-widget',
      'breached-tickets-widget',
    ]) {
      expect(wrapper.find(`[data-testid="${testid}"] [data-testid="widget-error"]`).exists()).toBe(true);
    }
  });

  it('keeps two same-named agents as separate workload rows', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
      if (filters.unassigned || filters.escalated) return [];
      if (filters.status === 'OPEN') {
        return [
          {
            id: 'w1',
            subject: 'Ticket A',
            status: 'OPEN',
            priority: 'MEDIUM',
            isEscalated: false,
            customer: { id: 'c1', fullName: 'Cust A' },
            category: null,
            department: null,
            assignee: { id: 'agentA', fullName: 'Agent Same Name', role: 'AGENT' },
            createdAt: new Date().toISOString(),
          },
          {
            id: 'w2',
            subject: 'Ticket B',
            status: 'OPEN',
            priority: 'MEDIUM',
            isEscalated: false,
            customer: { id: 'c2', fullName: 'Cust B' },
            category: null,
            department: null,
            assignee: { id: 'agentB', fullName: 'Agent Same Name', role: 'AGENT' },
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return [];
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const rowA = wrapper.find('[data-testid="workload-row-agentA"]');
    const rowB = wrapper.find('[data-testid="workload-row-agentB"]');
    expect(rowA.exists()).toBe(true);
    expect(rowB.exists()).toBe(true);
    expect(rowA.text()).toContain('1');
    expect(rowB.text()).toContain('1');
  });

  it('shows only breached tickets in the Breached Tickets widget for a supervisor, fetched from active statuses only', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
      if (filters.unassigned || filters.escalated) return [];
      if (filters.status === 'OPEN') {
        return [
          {
            id: 'b1',
            subject: 'Breached ticket',
            status: 'OPEN',
            priority: 'URGENT',
            isEscalated: false,
            customer: { id: 'c1', fullName: 'Breached Customer' },
            category: null,
            department: null,
            assignee: null,
            createdAt: new Date().toISOString(),
            sla: {
              response: { dueAt: new Date(Date.now() - 60_000).toISOString(), respondedAt: null, status: 'BREACHED' },
              resolution: { dueAt: new Date(Date.now() + 60_000).toISOString(), resolvedAt: null, status: 'PENDING' },
            },
          },
          {
            id: 'ok1',
            subject: 'On track ticket',
            status: 'OPEN',
            priority: 'LOW',
            isEscalated: false,
            customer: { id: 'c2', fullName: 'OnTrack Customer' },
            category: null,
            department: null,
            assignee: null,
            createdAt: new Date().toISOString(),
            sla: {
              response: { dueAt: new Date(Date.now() + 60_000).toISOString(), respondedAt: null, status: 'PENDING' },
              resolution: { dueAt: new Date(Date.now() + 120_000).toISOString(), resolvedAt: null, status: 'PENDING' },
            },
          },
        ];
      }
      if (filters.status === 'IN_PROGRESS') return [];
      return [];
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const widget = wrapper.find('[data-testid="breached-tickets-widget"]');
    expect(widget.text()).toContain('Breached ticket');
    expect(widget.text()).not.toContain('On track ticket');
    expect(fetchTickets).toHaveBeenCalledWith({ status: 'OPEN' });
    expect(fetchTickets).toHaveBeenCalledWith({ status: 'IN_PROGRESS' });
  });

  it('excludes a RESOLVED ticket with a stale BREACHED sla status from the Breached Tickets widget', async () => {
    loginAs('SUPERVISOR');
    vi.mocked(fetchTickets).mockImplementation(async (filters = {}) => {
      if (filters.unassigned || filters.escalated) return [];
      // A resolved ticket is never returned by the OPEN/IN_PROGRESS status-filtered
      // fetches the widget now performs, even though it may still carry a BREACHED
      // sla status from before it was resolved.
      if (filters.status === 'OPEN' || filters.status === 'IN_PROGRESS') return [];
      return [
        {
          id: 'resolved-breached',
          subject: 'Old resolved breach',
          status: 'RESOLVED',
          priority: 'URGENT',
          isEscalated: false,
          customer: { id: 'c3', fullName: 'Resolved Customer' },
          category: null,
          department: null,
          assignee: null,
          createdAt: new Date().toISOString(),
          sla: {
            response: { dueAt: new Date(Date.now() - 60_000).toISOString(), respondedAt: null, status: 'BREACHED' },
            resolution: { dueAt: new Date(Date.now() - 30_000).toISOString(), resolvedAt: null, status: 'BREACHED' },
          },
        },
      ];
    });

    const wrapper = mountWithPlugins(DashboardView, {}, dashboardRoutes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const widget = wrapper.find('[data-testid="breached-tickets-widget"]');
    expect(widget.text()).not.toContain('Old resolved breach');
    expect(widget.text()).toContain('No breached tickets.');
  });
});
