import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  fetchTicket: vi.fn(),
}));

import { fetchTicket } from '../../../src/api/tickets';
import TicketDetailView from '../../../src/views/tickets/TicketDetailView.vue';

describe('TicketDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicket).mockResolvedValue({
      id: 'ticket-1',
      subject: 'Cannot log in',
      description: 'Getting an error on login',
      status: 'OPEN',
      priority: 'HIGH',
      isEscalated: false,
      customer: { id: 'c1', fullName: 'Jane Customer' },
      category: null,
      department: null,
      assignee: null,
      createdBy: { id: 'u1', fullName: 'Agent Smith' },
      createdAt: '2026-08-27T00:00:00.000Z',
      events: [
        {
          id: 'e1',
          type: 'NOTE_ADDED',
          oldValue: null,
          newValue: null,
          note: 'Called the customer back',
          author: { id: 'u1', fullName: 'Agent Smith' },
          createdAt: '2026-08-27T01:00:00.000Z',
        },
      ],
    });
  });

  it('renders the ticket and its event timeline', async () => {
    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('Called the customer back');
  });
});
