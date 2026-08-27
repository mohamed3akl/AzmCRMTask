import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
}));

import { fetchDepartments } from '../../../src/api/departments';
import DepartmentListView from '../../../src/views/departments/DepartmentListView.vue';

describe('DepartmentListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchDepartments).mockResolvedValue([{ id: '1', nameEn: 'Support', nameAr: 'الدعم' }]);
  });

  it('renders fetched departments', async () => {
    const wrapper = mountWithPlugins(DepartmentListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Support');
  });
});
