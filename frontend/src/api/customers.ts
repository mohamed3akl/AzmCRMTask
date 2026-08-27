import { apiClient } from './client';

export interface ApiCustomer {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

export async function searchCustomers(query: string): Promise<ApiCustomer[]> {
  const res = await apiClient.get('/customers', { params: { query } });
  return res.data;
}
