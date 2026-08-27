import { apiClient } from './client';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

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
