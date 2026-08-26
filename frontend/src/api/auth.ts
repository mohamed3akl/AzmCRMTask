import { apiClient } from './client';
import type { CurrentUser } from '../stores/auth';

export async function loginRequest(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
  const res = await apiClient.post('/auth/login', { email, password });
  return res.data;
}
