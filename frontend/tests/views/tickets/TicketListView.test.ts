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

  it('sources the SLA chip label and color from the same decision, even for a stale PENDING status', async () => {
    // The server still reports response.status as PENDING (hasn't recomputed
    // yet), but the client-side due time has already passed. Label and color
    // must agree with each other regardless: both must read as breached.
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
          response: { dueAt: '2000-01-01T00:00:00.000Z', respondedAt: null, status: 'PENDING' },
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
    const chip = wrapper.findComponent({ name: 'VChip' });
    expect(chip.exists()).toBe(true);
    expect(chip.classes().join(' ')).toContain('text-error');
  });

  it('gives a genuinely server-side BREACHED sla status the same breached label and error color', async () => {
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

    const chip = wrapper.findComponent({ name: 'VChip' });
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain('SLA Breached');
    expect(chip.classes().join(' ')).toContain('text-error');
  });
});
