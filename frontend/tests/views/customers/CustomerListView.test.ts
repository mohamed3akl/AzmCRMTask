import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/customers', () => ({
  searchCustomers: vi.fn(),
  createCustomer: vi.fn(),
}));

import axios from 'axios';
import { searchCustomers, createCustomer } from '../../../src/api/customers';
import CustomerListView from '../../../src/views/customers/CustomerListView.vue';

const routes = [
  { path: '/', component: { template: '<div />' } },
  { path: '/customers', name: 'customers', component: CustomerListView },
  { path: '/customers/:id', name: 'customer-detail', component: { template: '<div />' } },
];

describe('CustomerListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(searchCustomers).mockResolvedValue([
      { id: 'c1', fullName: 'Jane Customer', email: 'jane@example.com', phone: null },
    ]);
  });

  it('renders searched customers', async () => {
    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('jane@example.com');
  });

  it('creates a customer and refreshes the list', async () => {
    vi.mocked(createCustomer).mockResolvedValue({ id: 'c2', fullName: 'New Customer', email: null, phone: null });

    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-create-button"]').trigger('click');
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-fullname"] input').setValue('New Customer');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(createCustomer).toHaveBeenCalledWith({ fullName: 'New Customer', email: undefined, phone: undefined });
  });

  it('shows the conflict message with a link to the existing customer on a 409', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 409'), {
      isAxiosError: true,
      response: {
        data: {
          error: { code: 'CUSTOMER_EXISTS', message: 'A customer with this email or phone already exists' },
          existingCustomerId: 'c1',
        },
      },
    });
    vi.mocked(createCustomer).mockRejectedValue(axiosError);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const wrapper = mountWithPlugins(CustomerListView, {}, routes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="customer-create-button"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-testid="customer-fullname"] input').setValue('Dup Customer');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="customer-error"]').exists()).toBe(true);
    const link = wrapper.find('[data-testid="customer-conflict-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/customers/c1');
  });
});
