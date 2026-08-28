import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  fetchTickets: vi.fn(),
}));

import { fetchTickets } from '../../../src/api/tickets';
import TicketListView from '../../../src/views/tickets/TicketListView.vue';

describe('TicketListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: '1',
        subject: 'Cannot log in',
        status: 'OPEN',
        priority: 'HIGH',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: '2026-08-27T00:00:00.000Z',
      },
    ]);
  });

  it('renders fetched tickets', async () => {
    const wrapper = mountWithPlugins(TicketListView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
  });

  it('shows an SLA chip reflecting the worse of the response/resolution clocks', async () => {
    vi.mocked(fetchTickets).mockResolvedValue([
      {
        id: '1',
        subject: 'Cannot log in',
        status: 'OPEN',
        priority: 'HIGH',
        isEscalated: false,
        customer: { id: 'c1', fullName: 'Jane Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: '2026-08-27T00:00:00.000Z',
        sla: {
          response: { dueAt: '2026-08-26T00:00:00.000Z', respondedAt: null, status: 'BREACHED' },
          resolution: { dueAt: '2026-08-28T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
        },
      },
      {
        id: '2',
        subject: 'Billing question',
        status: 'OPEN',
        priority: 'LOW',
        isEscalated: false,
        customer: { id: 'c2', fullName: 'Bob Customer' },
        category: null,
        department: null,
        assignee: null,
        createdAt: '2026-08-27T00:00:00.000Z',
        sla: {
          response: { dueAt: '2099-01-01T00:00:00.000Z', respondedAt: null, status: 'PENDING' },
          resolution: { dueAt: '2099-01-01T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
        },
      },
    ]);

    const wrapper = mountWithPlugins(TicketListView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
      { path: '/tickets/new', name: 'ticket-new', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('SLA Breached');
  });
});
