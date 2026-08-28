import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/slaTargets', () => ({
  fetchSlaTargets: vi.fn(),
  updateSlaTarget: vi.fn(),
}));

import axios from 'axios';
import { fetchSlaTargets, updateSlaTarget } from '../../../src/api/slaTargets';
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

  it('shows a visible error and keeps the dialog open when saving a target is rejected', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { data: { error: { message: 'responseMinutes must be a positive integer' } } },
    });
    vi.mocked(updateSlaTarget).mockRejectedValue(axiosError);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const wrapper = mountWithPlugins(SlaTargetListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    const editButton = wrapper.findAll('button').find((b) => b.text() === 'Edit');
    expect(editButton).toBeDefined();
    await editButton!.trigger('click'); // opens the edit dialog for the first row (URGENT)
    await wrapper.vm.$nextTick();

    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(updateSlaTarget).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="sla-target-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('responseMinutes must be a positive integer');
    // The dialog must not have silently closed as if the save had succeeded:
    // the form (rendered only while the dialog is open) is still present.
    expect(wrapper.find('form').exists()).toBe(true);
  });
});
