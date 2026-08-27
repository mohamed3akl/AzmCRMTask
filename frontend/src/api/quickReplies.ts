import { apiClient } from './client';

export interface ApiQuickReply {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export async function fetchQuickReplies(): Promise<ApiQuickReply[]> {
  const res = await apiClient.get('/quick-replies');
  return res.data;
}

export async function createQuickReply(data: {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}): Promise<ApiQuickReply> {
  const res = await apiClient.post('/quick-replies', data);
  return res.data;
}

export async function updateQuickReply(
  id: string,
  data: Partial<{ titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }>
): Promise<ApiQuickReply> {
  const res = await apiClient.patch(`/quick-replies/${id}`, data);
  return res.data;
}
