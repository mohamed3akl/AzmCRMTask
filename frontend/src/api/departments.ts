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
