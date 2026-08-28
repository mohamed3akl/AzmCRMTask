import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/customers', () => ({
  fetchCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

import axios from 'axios';
import { fetchCustomer, updateCustomer } from '../../../src/api/customers';
import CustomerDetailView from '../../../src/views/customers/CustomerDetailView.vue';

// Matches the existing convention in TicketDetailView.test.ts: the route's
// :id param is supplied via global.mocks.$route (not by actually navigating
// the real router — the mocked fetchCustomer ignores its argument anyway).
// The route table still needs a real 'customer-detail' entry, though,
// because the conflict-link's router-link resolves it for real.
const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
  { path: '/tickets/:id', name: 'ticket-detail', component: { template: '<div />' } },
];

function mountCustomerDetail() {
  return mountWithPlugins(CustomerDetailView, { global: { mocks: { $route: { params: { id: 'c1' } } } } }, routes);
}

describe('CustomerDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders the customer and their ticket history', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [{ id: 't1', subject: 'Cannot log in', status: 'OPEN', priority: 'HIGH', createdAt: '2026-08-27T00:00:00.000Z' }],
    });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('jane@example.com');
    expect(wrapper.text()).toContain('Cannot log in');
  });

  it('shows the empty state when the customer has no tickets', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: null,
      phone: null,
      tickets: [],
    });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('No tickets yet');
  });

  it('edits the customer and shows the updated info', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [],
    });
    vi.mocked(updateCustomer).mockResolvedValue({ id: 'c1', fullName: 'Jane Updated', email: 'jane@example.com', phone: null });

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-edit-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-fullname"] input').setValue('Jane Updated');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(updateCustomer).toHaveBeenCalledWith('c1', { fullName: 'Jane Updated', email: 'jane@example.com', phone: undefined });
    expect(wrapper.text()).toContain('Jane Updated');
  });

  it('shows the conflict message with a link to the existing customer on a 409', async () => {
    vi.mocked(fetchCustomer).mockResolvedValue({
      id: 'c1',
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: null,
      tickets: [],
    });
    const axiosError = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      response: {
        data: {
          error: { code: 'CUSTOMER_EXISTS', message: 'A customer with this email or phone already exists' },
          existingCustomerId: 'c2',
        },
      },
    });
    vi.mocked(updateCustomer).mockRejectedValue(axiosError);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const wrapper = mountCustomerDetail();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-edit-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-email"] input').setValue('taken@example.com');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="customer-error"]').exists()).toBe(true);
    const link = wrapper.find('[data-testid="customer-conflict-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/customers/c2');
  });
});
