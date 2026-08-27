import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/users', () => ({
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));

import { fetchUsers } from '../../../src/api/users';
import { fetchDepartments } from '../../../src/api/departments';
import UserListView from '../../../src/views/users/UserListView.vue';

describe('UserListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchUsers).mockResolvedValue([
      { id: '1', email: 'a@b.com', fullName: 'Alice Bee', role: 'AGENT', departmentId: null, isActive: true, locale: 'en' },
    ]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
  });

  it('renders fetched users', async () => {
    const wrapper = mountWithPlugins(UserListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Alice Bee');
  });
});
