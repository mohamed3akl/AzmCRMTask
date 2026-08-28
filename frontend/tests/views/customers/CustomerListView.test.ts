import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  describe('search debouncing', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('only issues one search request after rapid typing, for the final value', async () => {
      vi.useFakeTimers();

      const wrapper = mountWithPlugins(CustomerListView, {}, routes);
      // Flush the initial (undebounced) mount load without advancing fake
      // timers, since it doesn't go through the debounce timer.
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(searchCustomers).mockClear();

      const input = wrapper.find('[data-testid="customer-search"] input');
      await input.setValue('j');
      await input.setValue('ja');
      await input.setValue('jan');
      await input.setValue('jane');

      // Nothing should have fired yet: each keystroke should have reset the
      // pending debounce timer rather than triggering a request immediately.
      expect(searchCustomers).not.toHaveBeenCalled();

      // Let the debounce delay elapse.
      await vi.advanceTimersByTimeAsync(300);

      expect(searchCustomers).toHaveBeenCalledTimes(1);
      expect(searchCustomers).toHaveBeenCalledWith('jane');
    });

    it('applies only the latest response when an earlier request resolves out of order', async () => {
      vi.useFakeTimers();

      let resolveFirst: (value: unknown) => void = () => {};
      let resolveSecond: (value: unknown) => void = () => {};
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      const secondPromise = new Promise((resolve) => {
        resolveSecond = resolve;
      });

      vi.mocked(searchCustomers).mockResolvedValueOnce([
        { id: 'c1', fullName: 'Jane Customer', email: 'jane@example.com', phone: null },
      ] as never);

      const wrapper = mountWithPlugins(CustomerListView, {}, routes);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(searchCustomers).mockClear();
      vi.mocked(searchCustomers).mockReturnValueOnce(firstPromise as never);
      vi.mocked(searchCustomers).mockReturnValueOnce(secondPromise as never);

      const input = wrapper.find('[data-testid="customer-search"] input');

      // First (slower) search: "ja"
      await input.setValue('ja');
      await vi.advanceTimersByTimeAsync(300);

      // Second (faster) search: "jane", fired after the debounce for "ja" elapsed
      await input.setValue('jane');
      await vi.advanceTimersByTimeAsync(300);

      expect(searchCustomers).toHaveBeenCalledTimes(2);

      // Resolve the newer ("jane") request first, then the stale ("ja") one.
      resolveSecond([{ id: 'c2', fullName: 'Jane Two', email: null, phone: null }]);
      await vi.advanceTimersByTimeAsync(0);
      resolveFirst([{ id: 'c1', fullName: 'Jane Customer', email: 'jane@example.com', phone: null }]);
      await vi.advanceTimersByTimeAsync(0);

      expect(wrapper.text()).toContain('Jane Two');
      expect(wrapper.text()).not.toContain('Jane Customer');
    });
  });
});
