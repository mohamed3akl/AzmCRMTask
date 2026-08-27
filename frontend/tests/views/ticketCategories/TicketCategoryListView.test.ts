import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
  createTicketCategory: vi.fn(),
  updateTicketCategory: vi.fn(),
}));

import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import TicketCategoryListView from '../../../src/views/ticketCategories/TicketCategoryListView.vue';

describe('TicketCategoryListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicketCategories).mockResolvedValue([{ id: '1', nameEn: 'Billing', nameAr: 'الفواتير' }]);
  });

  it('renders fetched categories', async () => {
    const wrapper = mountWithPlugins(TicketCategoryListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Billing');
  });
});
