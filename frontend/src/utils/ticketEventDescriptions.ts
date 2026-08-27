import type { TicketEventType } from '../api/tickets';

export interface DescribableTicketEvent {
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

export function describeTicketEvent(event: DescribableTicketEvent, t: Translate): string {
  switch (event.type) {
    case 'STATUS_CHANGED':
      return t('ticketEvents.statusChanged', { old: event.oldValue, new: event.newValue });
    case 'PRIORITY_CHANGED':
      return t('ticketEvents.priorityChanged', { old: event.oldValue, new: event.newValue });
    case 'CATEGORY_CHANGED':
      return t('ticketEvents.categoryChanged');
    case 'DEPARTMENT_CHANGED':
      return t('ticketEvents.departmentChanged');
    case 'ASSIGNEE_CHANGED':
      return t('ticketEvents.assigneeChanged');
    case 'ESCALATED':
      return event.note ? t('ticketEvents.escalatedWithNote', { note: event.note }) : t('ticketEvents.escalated');
    case 'UNESCALATED':
      return t('ticketEvents.unescalated');
    case 'NOTE_ADDED':
      return event.note ?? '';
    default:
      return event.type;
  }
}
