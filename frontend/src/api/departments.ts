import { apiClient } from './client';

export interface ApiDepartment {
  id: string;
  nameEn: string;
  nameAr: string;
}

export async function fetchDepartments(): Promise<ApiDepartment[]> {
  const res = await apiClient.get('/departments');
  return res.data;
}

export async function createDepartment(data: { nameEn: string; nameAr: string }): Promise<ApiDepartment> {
  const res = await apiClient.post('/departments', data);
  return res.data;
}

export async function updateDepartment(
  id: string,
  data: Partial<{ nameEn: string; nameAr: string }>
): Promise<ApiDepartment> {
  const res = await apiClient.patch(`/departments/${id}`, data);
  return res.data;
}
