import { apiClient } from './client';

export interface ApiTicketCategory {
  id: string;
  nameEn: string;
  nameAr: string;
}

export async function fetchTicketCategories(): Promise<ApiTicketCategory[]> {
  const res = await apiClient.get('/ticket-categories');
  return res.data;
}

export async function createTicketCategory(data: { nameEn: string; nameAr: string }): Promise<ApiTicketCategory> {
  const res = await apiClient.post('/ticket-categories', data);
  return res.data;
}

export async function updateTicketCategory(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<ApiTicketCategory> {
  const res = await apiClient.patch(`/ticket-categories/${id}`, data);
  return res.data;
}
