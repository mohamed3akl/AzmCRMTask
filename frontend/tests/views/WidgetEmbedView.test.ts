import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../testUtils';

vi.mock('../../src/api/publicTickets', () => ({
  submitPublicTicket: vi.fn(),
}));

import { submitPublicTicket } from '../../src/api/publicTickets';
import WidgetEmbedView from '../../src/views/WidgetEmbedView.vue';

describe('WidgetEmbedView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(submitPublicTicket).mockReset();
    document.documentElement.dir = '';
    document.documentElement.lang = '';
    window.history.pushState({}, '', '/');
  });

  it('submits the form and shows the confirmation with the reference', async () => {
    vi.mocked(submitPublicTicket).mockResolvedValue({ reference: 'A1B2C3D4' });
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

    const wrapper = mountWithPlugins(WidgetEmbedView, {}, [
      { path: '/widget/embed', name: 'widget-embed', component: WidgetEmbedView },
    ]);
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="widget-full-name"] input').setValue('Jane Customer');
    await wrapper.find('[data-testid="widget-email"] input').setValue('jane@example.com');
    await wrapper.find('[data-testid="widget-subject"] input').setValue('Cannot log in');
    await wrapper.find('[data-testid="widget-description"] textarea').setValue('Getting an error');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(submitPublicTicket).toHaveBeenCalledWith({
      fullName: 'Jane Customer',
      email: 'jane@example.com',
      phone: undefined,
      subject: 'Cannot log in',
      description: 'Getting an error',
    });
    expect(wrapper.find('[data-testid="widget-confirmation"]').text()).toContain('A1B2C3D4');
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'azmcrm-widget' }), '*');
  });

  it('shows an error and does not submit when both email and phone are missing', async () => {
    const wrapper = mountWithPlugins(WidgetEmbedView, {}, [
      { path: '/widget/embed', name: 'widget-embed', component: WidgetEmbedView },
    ]);
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="widget-full-name"] input').setValue('No Contact');
    await wrapper.find('[data-testid="widget-subject"] input').setValue('Test');
    await wrapper.find('[data-testid="widget-description"] textarea').setValue('Test');
    await wrapper.find('form').trigger('submit.prevent');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="widget-error"]').exists()).toBe(true);
    expect(submitPublicTicket).not.toHaveBeenCalled();
  });

  it('shows a submit error and stays on the form when the API call rejects', async () => {
    vi.mocked(submitPublicTicket).mockRejectedValue(new Error('Network Error'));

    const wrapper = mountWithPlugins(WidgetEmbedView, {}, [
      { path: '/widget/embed', name: 'widget-embed', component: WidgetEmbedView },
    ]);
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="widget-full-name"] input').setValue('Jane Customer');
    await wrapper.find('[data-testid="widget-email"] input').setValue('jane@example.com');
    await wrapper.find('[data-testid="widget-subject"] input').setValue('Cannot log in');
    await wrapper.find('[data-testid="widget-description"] textarea').setValue('Getting an error');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(submitPublicTicket).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="widget-submit-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="widget-confirmation"]').exists()).toBe(false);
  });

  it('applies RTL layout when the locale query param is ar', async () => {
    window.history.pushState({}, '', '/widget/embed?locale=ar');

    const wrapper = mountWithPlugins(WidgetEmbedView, {}, [
      { path: '/widget/embed', name: 'widget-embed', component: WidgetEmbedView },
    ]);
    await wrapper.vm.$nextTick();

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
