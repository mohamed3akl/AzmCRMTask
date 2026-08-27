import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';

vi.mock('../../../src/api/quickReplies', () => ({
  fetchQuickReplies: vi.fn(),
  createQuickReply: vi.fn(),
  updateQuickReply: vi.fn(),
}));

import { fetchQuickReplies } from '../../../src/api/quickReplies';
import QuickReplyListView from '../../../src/views/quickReplies/QuickReplyListView.vue';

describe('QuickReplyListView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchQuickReplies).mockResolvedValue([
      { id: '1', titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello!', bodyAr: 'مرحبًا!' },
    ]);
  });

  it('renders fetched quick replies', async () => {
    const wrapper = mountWithPlugins(QuickReplyListView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Greeting');
  });
});
