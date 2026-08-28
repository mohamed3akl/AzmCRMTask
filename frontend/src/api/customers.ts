import { apiClient } from './client';

export interface ApiCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface ApiCustomerTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

export interface ApiCustomerDetail extends ApiCustomer {
  tickets: ApiCustomerTicket[];
}

export async function searchCustomers(query: string): Promise<ApiCustomer[]> {
  const res = await apiClient.get('/customers', { params: { query } });
  return res.data;
}

export async function fetchCustomer(id: string): Promise<ApiCustomerDetail> {
  const res = await apiClient.get(`/customers/${id}`);
  return res.data;
}

export async function createCustomer(data: { fullName: string; email?: string; phone?: string }): Promise<ApiCustomer> {
  const res = await apiClient.post('/customers', data);
  return res.data;
}

export async function updateCustomer(
  id: string,
  data: Partial<{ fullName: string; email: string; phone: string }>
): Promise<ApiCustomer> {
  const res = await apiClient.patch(`/customers/${id}`, data);
  return res.data;
}
