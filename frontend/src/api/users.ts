import { apiClient } from './client';

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  role: 'AGENT' | 'SUPERVISOR' | 'ADMIN';
  departmentId: string | null;
  isActive: boolean;
  locale: string;
}

export async function fetchUsers(): Promise<ApiUser[]> {
  const res = await apiClient.get('/users');
  return res.data;
}

export async function createUser(data: {
  email: string;
  password: string;
  fullName: string;
  role: ApiUser['role'];
  departmentId?: string | null;
}): Promise<ApiUser> {
  const res = await apiClient.post('/users', data);
  return res.data;
}

export async function updateUser(
  id: string,
  data: Partial<{ fullName: string; role: ApiUser['role']; departmentId: string | null }>
): Promise<ApiUser> {
  const res = await apiClient.patch(`/users/${id}`, data);
  return res.data;
}

export async function deactivateUser(id: string): Promise<ApiUser> {
  const res = await apiClient.post(`/users/${id}/deactivate`);
  return res.data;
}
