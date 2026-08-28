import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mountWithPlugins } from '../../testUtils';
import { useAuthStore } from '../../../src/stores/auth';

vi.mock('../../../src/api/tickets', () => ({
  fetchTicket: vi.fn(),
  updateTicket: vi.fn(),
  assignTicket: vi.fn(),
  escalateTicket: vi.fn(),
  unescalateTicket: vi.fn(),
  addTicketNote: vi.fn(),
}));
vi.mock('../../../src/api/ticketCategories', () => ({
  fetchTicketCategories: vi.fn(),
}));
vi.mock('../../../src/api/departments', () => ({
  fetchDepartments: vi.fn(),
}));
vi.mock('../../../src/api/users', () => ({
  fetchUsers: vi.fn(),
}));
vi.mock('../../../src/api/quickReplies', () => ({
  fetchQuickReplies: vi.fn(),
}));

import { fetchTicket, addTicketNote } from '../../../src/api/tickets';
import { fetchTicketCategories } from '../../../src/api/ticketCategories';
import { fetchDepartments } from '../../../src/api/departments';
import { fetchUsers } from '../../../src/api/users';
import { fetchQuickReplies } from '../../../src/api/quickReplies';
import TicketDetailView from '../../../src/views/tickets/TicketDetailView.vue';

const baseTicket = {
  id: 'ticket-1',
  subject: 'Cannot log in',
  description: 'Getting an error on login',
  status: 'OPEN' as const,
  priority: 'HIGH' as const,
  isEscalated: false,
  customer: { id: 'c1', fullName: 'Jane Customer' },
  category: null,
  department: null,
  assignee: null,
  createdBy: { id: 'u1', fullName: 'Agent Smith' },
  createdAt: '2026-08-27T00:00:00.000Z',
  events: [
    {
      id: 'e1',
      type: 'NOTE_ADDED' as const,
      oldValue: null,
      newValue: null,
      note: 'Called the customer back',
      author: { id: 'u1', fullName: 'Agent Smith' },
      createdAt: '2026-08-27T01:00:00.000Z',
    },
  ],
};

describe('TicketDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchTicket).mockResolvedValue(baseTicket);
    vi.mocked(fetchTicketCategories).mockResolvedValue([]);
    vi.mocked(fetchDepartments).mockResolvedValue([]);
    vi.mocked(fetchUsers).mockResolvedValue([]);
    vi.mocked(fetchQuickReplies).mockResolvedValue([]);
  });

  it('renders the ticket and its event timeline', async () => {
    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
    expect(wrapper.text()).toContain('Jane Customer');
    expect(wrapper.text()).toContain('Called the customer back');
  });

  it('adds a note', async () => {
    vi.mocked(addTicketNote).mockResolvedValue({
      ...baseTicket,
      events: [
        ...baseTicket.events,
        {
          id: 'e2',
          type: 'NOTE_ADDED',
          oldValue: null,
          newValue: null,
          note: 'Follow-up call scheduled',
          author: { id: 'u1', fullName: 'Agent Smith' },
          createdAt: '2026-08-27T02:00:00.000Z',
        },
      ],
    });

    const auth = useAuthStore();
    auth.currentUser = {
      id: 'u1',
      email: 'agent@example.com',
      fullName: 'Agent Smith',
      role: 'AGENT',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="note-input"] input').setValue('Follow-up call scheduled');
    await wrapper.find('[data-testid="add-note-button"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(addTicketNote).toHaveBeenCalledWith('ticket-1', 'Follow-up call scheduled');
    expect(wrapper.text()).toContain('Follow-up call scheduled');
  });

  it('inserts a quick reply into the note field', async () => {
    vi.mocked(fetchQuickReplies).mockResolvedValue([
      { id: 'qr1', titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello, thanks for reaching out!', bodyAr: 'مرحبًا!' },
    ]);

    const auth = useAuthStore();
    auth.currentUser = {
      id: 'u1',
      email: 'agent@example.com',
      fullName: 'Agent Smith',
      role: 'AGENT',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="quick-reply-select"] input').trigger('mousedown');
    await wrapper.vm.$nextTick();
    const option = wrapper.find('[data-testid="quick-reply-option-qr1"]');
    expect(option.exists()).toBe(true);
    await option.trigger('click');
    await wrapper.vm.$nextTick();

    const noteInput = wrapper.find('[data-testid="note-input"] input').element as HTMLInputElement;
    expect(noteInput.value).toBe('Hello, thanks for reaching out!');
  });

  it('inserts the quick reply body for the active UI locale, not the account locale', async () => {
    vi.mocked(fetchQuickReplies).mockResolvedValue([
      { id: 'qr1', titleEn: 'Greeting', titleAr: 'ترحيب', bodyEn: 'Hello, thanks for reaching out!', bodyAr: 'مرحبًا!' },
    ]);

    const auth = useAuthStore();
    auth.currentUser = {
      id: 'u1',
      email: 'agent@example.com',
      fullName: 'Agent Smith',
      role: 'AGENT',
      departmentId: null,
      isActive: true,
      locale: 'en',
    };

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    // Switch the active UI locale to Arabic while the account's stored
    // locale preference stays 'en', simulating a user switching languages
    // via the nav menu (AppShell's setLocale) without their account record
    // changing. The inserted body must follow the active UI locale.
    (wrapper.vm.$i18n as { locale: string }).locale = 'ar';
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="quick-reply-select"] input').trigger('mousedown');
    await wrapper.vm.$nextTick();
    const option = wrapper.find('[data-testid="quick-reply-option-qr1"]');
    expect(option.exists()).toBe(true);
    expect(option.text()).toContain('ترحيب');
    await option.trigger('click');
    await wrapper.vm.$nextTick();

    const noteInput = wrapper.find('[data-testid="note-input"] input').element as HTMLInputElement;
    expect(noteInput.value).toBe('مرحبًا!');
  });

  it('renders without crashing when the ticket has no creator (e.g. a web-form submission)', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({ ...baseTicket, createdBy: null });

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Cannot log in');
  });

  it('shows the response and resolution SLA breakdown when sla data is present', async () => {
    vi.mocked(fetchTicket).mockResolvedValue({
      ...baseTicket,
      sla: {
        response: { dueAt: '2026-08-27T05:00:00.000Z', respondedAt: null, status: 'BREACHED' },
        resolution: { dueAt: '2026-08-28T00:00:00.000Z', resolvedAt: null, status: 'PENDING' },
      },
    });

    const wrapper = mountWithPlugins(
      TicketDetailView,
      { global: { mocks: { $route: { params: { id: 'ticket-1' } } } } },
      [{ path: '/', component: { template: '<div />' } }]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('SLA Breached');
    expect(wrapper.text()).toContain('Pending');
  });
});
