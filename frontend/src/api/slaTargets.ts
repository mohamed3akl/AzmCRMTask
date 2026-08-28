import { apiClient } from './client';

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface ApiSlaTarget {
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
}

export async function fetchSlaTargets(): Promise<ApiSlaTarget[]> {
  const res = await apiClient.get('/sla-targets');
  return res.data;
}

export async function updateSlaTarget(
  priority: TicketPriority,
  data: Partial<{ responseMinutes: number; resolutionMinutes: number }>
): Promise<ApiSlaTarget> {
  const res = await apiClient.patch(`/sla-targets/${priority}`, data);
  return res.data;
}
