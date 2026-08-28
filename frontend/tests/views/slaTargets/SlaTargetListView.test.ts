import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/slaTargets', () => ({
  fetchSlaTargets: vi.fn(),
  updateSlaTarget: vi.fn(),
}));

import { fetchSlaTargets } from '../../../src/api/slaTargets';
import SlaTargetListView from '../../../src/views/slaTargets/SlaTargetListView.vue';

describe('SlaTargetListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchSlaTargets).mockResolvedValue([
      { priority: 'URGENT', responseMinutes: 15, resolutionMinutes: 120 },
      { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
      { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 4320 },
    ]);
  });

  it('renders the four seeded targets', async () => {
    const wrapper = mountWithPlugins(SlaTargetListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('URGENT');
    expect(wrapper.text()).toContain('15');
    expect(wrapper.text()).toContain('4320');
  });
});
