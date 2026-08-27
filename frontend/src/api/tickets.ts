import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketEventType =
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'DEPARTMENT_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'ESCALATED'
  | 'UNESCALATED'
  | 'NOTE_ADDED';

export interface ApiTicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  isEscalated: boolean;
  customer: { id: string; fullName: string };
  category: { id: string; nameEn: string; nameAr: string } | null;
  department: { id: string; nameEn: string; nameAr: string } | null;
  assignee: { id: string; fullName: string; role: string } | null;
  createdAt: string;
}

export interface ApiTicketEvent {
  id: string;
  type: TicketEventType;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  author: { id: string; fullName: string };
  createdAt: string;
}

export interface ApiTicketDetail extends ApiTicketSummary {
  description: string;
  createdBy: { id: string; fullName: string };
  events: ApiTicketEvent[];
}

export async function fetchTickets(filters: { status?: TicketStatus } = {}): Promise<ApiTicketSummary[]> {
  const res = await apiClient.get('/tickets', { params: filters });
  return res.data;
}

export async function createTicket(data: {
  subject: string;
  description: string;
  customerId?: string;
  newCustomer?: { fullName: string; email?: string; phone?: string };
  categoryId?: string | null;
  departmentId?: string | null;
  priority?: TicketPriority;
}): Promise<{ id: string }> {
  const res = await apiClient.post('/tickets', data);
  return res.data;
}

export async function fetchTicket(id: string): Promise<ApiTicketDetail> {
  const res = await apiClient.get(`/tickets/${id}`);
  return res.data;
}

export async function updateTicket(
  id: string,
  data: Partial<{ status: TicketStatus; priority: TicketPriority; categoryId: string | null; departmentId: string | null }>
): Promise<ApiTicketDetail> {
  const res = await apiClient.patch(`/tickets/${id}`, data);
  return res.data;
}

export async function assignTicket(id: string, assigneeId: string | null): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/assign`, { assigneeId });
  return res.data;
}

export async function escalateTicket(id: string, note?: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/escalate`, { note });
  return res.data;
}

export async function unescalateTicket(id: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/unescalate`);
  return res.data;
}

export async function addTicketNote(id: string, note: string): Promise<ApiTicketDetail> {
  const res = await apiClient.post(`/tickets/${id}/notes`, { note });
  return res.data;
}
