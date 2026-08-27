import { apiClient } from './client';

export interface ApiTask {
  id: string;
  title: string;
  dueAt: string | null;
  isDone: boolean;
  ownerId: string;
  ticketId: string | null;
}

export async function fetchTasks(filters: { done?: boolean; ticketId?: string } = {}): Promise<ApiTask[]> {
  const res = await apiClient.get('/tasks', { params: filters });
  return res.data;
}

export async function createTask(data: {
  title: string;
  dueAt?: string | null;
  ticketId?: string | null;
}): Promise<ApiTask> {
  const res = await apiClient.post('/tasks', data);
  return res.data;
}

export async function updateTask(
  id: string,
  data: Partial<{ title: string; dueAt: string | null; ticketId: string | null; isDone: boolean }>
): Promise<ApiTask> {
  const res = await apiClient.patch(`/tasks/${id}`, data);
  return res.data;
}

export async function deleteTask(id: string): Promise<void> {
  await apiClient.delete(`/tasks/${id}`);
}
