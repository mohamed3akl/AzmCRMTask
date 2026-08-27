import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/tickets', () => ({
  createTicket: vi.fn(),
}));
vi.mock('../../../src/api/customers', () => ({
  searchCustomers: vi.fn(),
}));
vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));

import { createTicket } from '../../../src/api/tickets';
import { searchCustomers } from '../../../src/api/customers';
import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import { fetchDepartments } from '../../../src/api/departments';
import TicketCreateView from '../../../src/views/tickets/TicketCreateView.vue';

describe('TicketCreateView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(searchCustomers).mockResolvedValue([]);
    vi.mocked(fetchTicketCategories).mockResolvedValue([]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
    vi.mocked(createTicket).mockResolvedValue({ id: 'new-ticket-id' });
  });

  it('creates a ticket with an inline new customer and navigates to it', async () => {
    const wrapper = mountWithPlugins(TicketCreateView, {}, [
      { path: '/', component: { template: '<div />' } },
      { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.find('[data-testid="toggle-new-customer"]').trigger('click');
    await wrapper.find('[data-testid="new-customer-name"] input').setValue('Jane Customer');
    await wrapper.find('[data-testid="ticket-subject"] input').setValue('Cannot log in');
    await wrapper.find('[data-testid="ticket-description"] textarea').setValue('Getting an error');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Cannot log in',
        description: 'Getting an error',
        newCustomer: expect.objectContaining({ fullName: 'Jane Customer' }),
      })
    );
  });
});
